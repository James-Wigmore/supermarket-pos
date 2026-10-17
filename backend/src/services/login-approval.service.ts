import { createHash, randomBytes } from 'node:crypto';
import type { LoginApproval, LoginApprovalStatus, User } from '@prisma/client';
import { env } from '../config/env';
import { actorOf, type RequestContext } from '../lib/actor';
import { audit } from '../lib/audit';
import { AppError, gone, serviceUnavailable } from '../lib/errors';
import { failureLimiter } from '../lib/failureLimiter';
import { logger } from '../lib/logger';
import { prisma, transact, type Db } from '../lib/prisma';
import { getSettings } from '../lib/settings';
import type { Actor } from '../types';
import { describeEmailError, sendEmail } from './email.service';
import { approvalEmail, maskEmail } from './login-approval.mail';

export const APPROVAL_TTL_MS = 5 * 60_000;
/** After approval the waiting browser has this long to pick up its session, even if the five minutes have passed. */
export const CLAIM_GRACE_MS = 2 * 60_000;

type Row = LoginApproval & { user: User };
export type LinkAction = 'approve' | 'reject';

const emailPerUser = failureLimiter(3, 10 * 60_000, 'Too many approval emails were requested for this account. Wait a few minutes and try again.');
const emailPerIp = failureLimiter(10, 15 * 60_000, 'Too many approval emails were requested from this device. Wait a few minutes and try again.');
const checksPerRequest = failureLimiter(60, 60_000, 'Checking too often. Wait a moment.');
const badTokensPerIp = failureLimiter(20, 15 * 60_000, 'Too many invalid attempts. Try again in a few minutes.');

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');
const ipKey = (ctx: RequestContext) => ctx.ip ?? 'unknown';
const OPEN: LoginApprovalStatus[] = ['PENDING', 'APPROVED'];

const log = (action: string, row: Row, ctx: RequestContext, after?: Record<string, unknown>, db: Db = prisma) =>
  audit(db, actorOf(row.user, ctx), { action, entity: 'LoginApproval', entityId: row.id, after });

const load = (where: { pollTokenHash: string } | { approveTokenHash: string } | { rejectTokenHash: string } | { id: string }) =>
  prisma.loginApproval.findUnique({ where, include: { user: true } });

/** Moves a request that ran out of time to EXPIRED (once) and records it. Returns the row as it now stands. */
const settle = async (row: Row): Promise<Row> => {
  const now = new Date();
  const lapsed = (row.status === 'PENDING' && row.expiresAt <= now) || (row.status === 'APPROVED' && row.claimUntil !== null && row.claimUntil <= now);
  if (!lapsed) return row;
  const { count } = await prisma.loginApproval.updateMany({ where: { id: row.id, status: row.status }, data: { status: 'EXPIRED' } });
  if (count) await log('LOGIN_APPROVAL_EXPIRED', row, {}, { wasApproved: row.status === 'APPROVED' });
  return (await load({ id: row.id })) ?? row;
};

/** Why a request cannot be used any more, in words for the person waiting at the till. */
const refusal = (status: LoginApprovalStatus) => {
  switch (status) {
    case 'REJECTED': return new AppError(403, 'This sign-in was rejected. If it was not you, ask your manager to reset your password.', 'APPROVAL_REJECTED');
    case 'EXPIRED': return gone('This sign-in request expired. Sign in again to get a new email.', 'APPROVAL_EXPIRED');
    case 'CANCELLED': return gone('This sign-in request was cancelled. Sign in again.', 'APPROVAL_CANCELLED');
    case 'FAILED': return gone('The approval email could not be sent. Sign in again.', 'APPROVAL_FAILED');
    case 'COMPLETED': return new AppError(409, 'This sign-in request has already been used. Sign in again.', 'APPROVAL_USED');
    default: return new AppError(409, 'This sign-in has not been approved yet.', 'APPROVAL_PENDING');
  }
};

/** The same, as shown on the page opened from the email. */
const linkRefusal = (status: LoginApprovalStatus) =>
  status === 'APPROVED' || status === 'COMPLETED'
    ? new AppError(409, 'This sign-in was already approved. The link can only be used once.', 'APPROVAL_USED')
    : status === 'REJECTED'
      ? new AppError(409, 'This sign-in was already rejected. The link can only be used once.', 'APPROVAL_USED')
      : status === 'EXPIRED' || status === 'FAILED' ? gone('This link has expired. Sign in again to get a new email.', 'APPROVAL_EXPIRED')
        : gone('This request was cancelled or replaced by a newer sign-in. Use the latest email.', 'APPROVAL_CANCELLED');

/** Cancels everything still open for a user (new sign-in, password reset, deactivation, email change, ...). */
export const cancelOpenApprovals = async (userId: string, reason: string, actor: Actor | null, db: Db = prisma) => {
  const open = await db.loginApproval.findMany({ where: { userId, status: { in: OPEN } }, select: { id: true } });
  for (const { id } of open) {
    const { count } = await db.loginApproval.updateMany({ where: { id, status: { in: OPEN } }, data: { status: 'CANCELLED' } });
    if (count) await audit(db, actor, { action: 'LOGIN_APPROVAL_CANCELLED', entity: 'LoginApproval', entityId: id, after: { userId, reason } });
  }
};

/** Called after valid credentials: records a pending request and emails the approve / reject links. */
export const startLoginApproval = async (user: User, ctx: RequestContext) => {
  emailPerUser.consume(user.id);
  emailPerIp.consume(ipKey(ctx));

  const approve = newToken();
  const reject = newToken();
  const poll = newToken();
  const requestedAt = new Date();
  const expiresAt = new Date(requestedAt.getTime() + APPROVAL_TTL_MS);
  const actor = actorOf(user, ctx);

  const row = await transact(async (tx) => {
    await cancelOpenApprovals(user.id, 'replaced by a newer sign-in', actor, tx);
    const created = await tx.loginApproval.create({
      data: {
        userId: user.id, sentTo: user.email, expiresAt, tokenVersion: user.tokenVersion, ip: ctx.ip, userAgent: ctx.userAgent?.slice(0, 255),
        approveTokenHash: sha256(approve), rejectTokenHash: sha256(reject), pollTokenHash: sha256(poll),
      },
    });
    await audit(tx, actor, { action: 'LOGIN_APPROVAL_REQUESTED', entity: 'LoginApproval', entityId: created.id, after: { sentTo: maskEmail(user.email), expiresAt } });
    return created;
  });

  try {
    const base = env.PUBLIC_BASE_URL!.replace(/\/+$/, '');
    await sendEmail(approvalEmail({
      to: user.email, name: user.name, storeName: (await getSettings()).receipt.storeName, requestedAt, minutes: APPROVAL_TTL_MS / 60_000, ip: ctx.ip, userAgent: ctx.userAgent,
      approveUrl: `${base}/api/auth/approve?token=${approve}`, rejectUrl: `${base}/api/auth/reject?token=${reject}`,
    }));
  } catch (err) {
    const reason = describeEmailError(err);
    logger.error(`Login approval email failed: ${reason}`);
    await prisma.loginApproval.updateMany({ where: { id: row.id, status: 'PENDING' }, data: { status: 'FAILED' } });
    await audit(prisma, actor, { action: 'LOGIN_APPROVAL_EMAIL_FAILED', entity: 'LoginApproval', entityId: row.id, after: { reason } });
    throw serviceUnavailable("We couldn't send the approval email. Try again in a moment, or ask your manager to check the email settings.", 'EMAIL_DELIVERY_FAILED');
  }

  return { nextStep: 'emailApproval' as const, requestToken: poll, secondsLeft: APPROVAL_TTL_MS / 1000, emailHint: maskEmail(user.email) };
};

/** Finds the request behind a browser's polling token. Unknown tokens count against the caller's address. */
const findForBrowser = async (pollToken: string, ctx: RequestContext) => {
  badTokensPerIp.assertOpen(ipKey(ctx));
  const row = await load({ pollTokenHash: sha256(pollToken) });
  if (!row) {
    badTokensPerIp.fail(ipKey(ctx));
    throw new AppError(404, 'This sign-in request is no longer available. Sign in again.', 'APPROVAL_NOT_FOUND');
  }
  checksPerRequest.consume(row.id);
  return settle(row);
};

const secondsLeft = (row: Row) => {
  const end = row.status === 'APPROVED' ? row.claimUntil : row.status === 'PENDING' ? row.expiresAt : null;
  return end ? Math.max(0, Math.ceil((end.getTime() - Date.now()) / 1000)) : 0;
};

/** Safe to poll: reveals only the state of the caller's own request, never a session. */
export const approvalStatus = async (pollToken: string, ctx: RequestContext) => {
  const row = await findForBrowser(pollToken, ctx);
  return { status: row.status, secondsLeft: secondsLeft(row) };
};

export const cancelApproval = async (pollToken: string, ctx: RequestContext) => {
  const row = await findForBrowser(pollToken, ctx);
  const { count } = await prisma.loginApproval.updateMany({ where: { id: row.id, status: { in: OPEN } }, data: { status: 'CANCELLED' } });
  if (count) await log('LOGIN_APPROVAL_CANCELLED', row, ctx, { reason: 'cancelled by the person signing in' });
  return { status: count ? 'CANCELLED' : row.status };
};

/** Turns an approved request into a sign-in, exactly once. The caller then issues the session. */
export const claimApprovedLogin = async (pollToken: string, ctx: RequestContext) => {
  const row = await findForBrowser(pollToken, ctx);
  if (row.status !== 'APPROVED') throw refusal(row.status);
  const { user } = row;
  if (!user.isActive || user.tokenVersion !== row.tokenVersion || user.email !== row.sentTo) {
    await prisma.loginApproval.updateMany({ where: { id: row.id, status: 'APPROVED' }, data: { status: 'CANCELLED' } });
    await log('LOGIN_APPROVAL_CANCELLED', row, ctx, { reason: 'account changed before the sign-in was completed' });
    throw refusal('CANCELLED');
  }
  const { count } = await prisma.loginApproval.updateMany({
    where: { id: row.id, status: 'APPROVED', claimUntil: { gt: new Date() } },
    data: { status: 'COMPLETED', claimedAt: new Date() },
  });
  if (count !== 1) throw refusal((await load({ id: row.id }))?.status ?? 'EXPIRED');
  return { user, approvalId: row.id };
};

/** Looks up the request behind an email link. The approve link and the reject link are different secrets. */
const findForLink = async (action: LinkAction, token: string, ctx: RequestContext) => {
  badTokensPerIp.assertOpen(ipKey(ctx));
  const hash = sha256(token);
  const row = await load(action === 'approve' ? { approveTokenHash: hash } : { rejectTokenHash: hash });
  if (!row) {
    badTokensPerIp.fail(ipKey(ctx));
    await audit(prisma, null, { action: 'LOGIN_APPROVAL_INVALID_LINK', entity: 'LoginApproval', after: { attempted: action, ip: ctx.ip } });
    throw gone('This link is not valid. It may be incomplete, expired or already used.', 'APPROVAL_INVALID');
  }
  const settled = await settle(row);
  if (settled.status !== 'PENDING') throw linkRefusal(settled.status);
  return settled;
};

/** What the confirmation page shows before the person presses the button (opening the link changes nothing). */
export const inspectLink = async (action: LinkAction, token: string, ctx: RequestContext) => {
  const row = await findForLink(action, token, ctx);
  return { email: row.sentTo, name: row.user.name, requestedAt: row.createdAt, ip: row.ip, userAgent: row.userAgent, secondsLeft: secondsLeft(row) };
};

/** The button on the confirmation page. Only a still-pending, unexpired request of an unchanged, active account can be decided. */
export const decideLink = async (action: LinkAction, token: string, ctx: RequestContext) => {
  const row = await findForLink(action, token, ctx);
  const { user } = row;
  if (!user.isActive || user.tokenVersion !== row.tokenVersion || user.email !== row.sentTo) {
    await prisma.loginApproval.updateMany({ where: { id: row.id, status: 'PENDING' }, data: { status: 'CANCELLED' } });
    await log('LOGIN_APPROVAL_CANCELLED', row, ctx, { reason: 'account changed before the link was used' });
    throw linkRefusal('CANCELLED');
  }
  const now = new Date();
  const { count } = await prisma.loginApproval.updateMany({
    where: { id: row.id, userId: user.id, status: 'PENDING', expiresAt: { gt: now } },
    data: action === 'approve' ? { status: 'APPROVED', decidedAt: now, claimUntil: new Date(now.getTime() + CLAIM_GRACE_MS) } : { status: 'REJECTED', decidedAt: now },
  });
  if (count !== 1) throw linkRefusal((await settle((await load({ id: row.id }))!)).status);
  await log(action === 'approve' ? 'LOGIN_APPROVAL_APPROVED' : 'LOGIN_APPROVAL_REJECTED', row, ctx, { requestedFromIp: row.ip, decidedFromIp: ctx.ip });
};

/** Housekeeping: expires requests nobody answered (each is audited) and drops finished ones after a week. */
export const sweepApprovals = async () => {
  const now = new Date();
  const stale = await prisma.loginApproval.findMany({
    where: { OR: [{ status: 'PENDING', expiresAt: { lte: now } }, { status: 'APPROVED', claimUntil: { lte: now } }] },
    include: { user: true },
    take: 200,
  });
  for (const row of stale) await settle(row);
  await prisma.loginApproval.deleteMany({ where: { status: { notIn: OPEN }, createdAt: { lt: new Date(now.getTime() - 7 * 24 * 3600_000) } } });
};
