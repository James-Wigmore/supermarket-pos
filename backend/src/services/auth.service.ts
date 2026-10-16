import bcrypt from 'bcryptjs';
import type { User } from '@prisma/client';
import { env } from '../config/env';
import { actorOf, type RequestContext as Ctx } from '../lib/actor';
import { audit } from '../lib/audit';
import { badRequest, forbidden, serviceUnavailable, unauthorized } from '../lib/errors';
import { failureLimiter } from '../lib/failureLimiter';
import { logger } from '../lib/logger';
import { can, P, ROLE_PERMISSIONS } from '../lib/permissions';
import { prisma } from '../lib/prisma';
import { getSettings } from '../lib/settings';
import { signToken } from '../middleware/auth';
import type { Actor } from '../types';
import { describeEmailError, emailConfigured, sendEmail } from './email.service';
import { cancelOpenApprovals, claimApprovedLogin, startLoginApproval } from './login-approval.service';

// Compared against when the user does not exist, so timing does not reveal valid emails.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', env.BCRYPT_ROUNDS);
const passwordChecks = failureLimiter(5, 15 * 60_000, 'Too many wrong passwords. Try again in a few minutes.');

export const hashPassword = (password: string) => bcrypt.hash(password, env.BCRYPT_ROUNDS);

/** Email approval is required for the roles in settings; anyone else may opt in. Without a configured mail server it is OFF for everyone. */
export const approvalPolicy = async (user: Pick<User, 'role' | 'emailApprovalEnabled'>) => {
  const required = (await getSettings()).loginApprovalRequiredRoles.includes(user.role);
  const configured = emailConfigured();
  return { configured, required, optedIn: user.emailApprovalEnabled, enabled: configured && (required || user.emailApprovalEnabled) };
};

export const sessionInfo = async (actor: Actor) => {
  const branch = actor.branchId
    ? await prisma.branch.findUnique({ where: { id: actor.branchId }, select: { id: true, name: true, code: true } })
    : null;
  const row = await prisma.user.findUniqueOrThrow({ where: { id: actor.id }, select: { role: true, emailApprovalEnabled: true } });
  return {
    user: { id: actor.id, name: actor.name, email: actor.email, role: actor.role, branchId: actor.branchId },
    branch,
    permissions: ROLE_PERMISSIONS[actor.role],
    loginApproval: await approvalPolicy(row),
  };
};

const finishLogin = async (user: User, ctx: Ctx, method: 'password' | 'email_approval', extra: Record<string, unknown> = {}) => {
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const actor = actorOf(user, ctx);
  await audit(prisma, actor, { action: 'LOGIN', entity: 'User', entityId: user.id, after: { method, ...extra } });
  return { token: signToken(user), ...(await sessionInfo(actor)) };
};

/** Step 1 of signing in. Returns a session, or (when email approval applies) a pending request to wait on. */
export const login = async (email: string, password: string, ctx: Ctx) => {
  const found = await prisma.user.findUnique({ where: { email } });
  const valid = await bcrypt.compare(password, found?.passwordHash ?? DUMMY_HASH);
  if (!found || !valid || !found.isActive) {
    if (found) await audit(prisma, null, { action: 'LOGIN_FAILED', entity: 'User', entityId: found.id, after: { email, ...ctx } });
    throw unauthorized('Invalid email or password');
  }
  const policy = await approvalPolicy(found);
  if (policy.enabled) return startLoginApproval(found, ctx);
  // Email security is not running: sign in with the password alone, and say so in the audit log.
  return finishLogin(found, ctx, 'password', policy.configured ? {} : { emailApproval: 'OFF', wouldRequire: policy.required || policy.optedIn });
};

/** Step 2: the browser that asked for approval collects its session once the email link was approved. */
export const completeApprovedLogin = async (requestToken: string, ctx: Ctx) => {
  const { user, approvalId } = await claimApprovedLogin(requestToken, ctx);
  return finishLogin(user, ctx, 'email_approval', { approvalId });
};

export const logout = (actor: Actor) => audit(prisma, actor, { action: 'LOGOUT', entity: 'User', entityId: actor.id });

const checkOwnPassword = async (user: User, password: string) => {
  passwordChecks.assertOpen(user.id);
  if (await bcrypt.compare(password, user.passwordHash)) return passwordChecks.clear(user.id);
  passwordChecks.fail(user.id);
  throw badRequest('Current password is incorrect');
};

/** Only managers and above change their own password; everyone else asks the manager above them. */
export const changePassword = async (actor: Actor, currentPassword: string, newPassword: string) => {
  if (!can(actor.role, P.USER_MANAGE)) throw forbidden('Ask your manager to reset your password');
  await checkOwnPassword(await prisma.user.findUniqueOrThrow({ where: { id: actor.id } }), currentPassword);
  const updated = await prisma.user.update({ where: { id: actor.id }, data: { passwordHash: await hashPassword(newPassword), tokenVersion: { increment: 1 } } });
  await cancelOpenApprovals(actor.id, 'password changed', actor);
  await audit(prisma, actor, { action: 'PASSWORD_CHANGE', entity: 'User', entityId: actor.id });
  return { token: signToken(updated) };
};

/** Users may opt in to email approval, and out again only when their role does not require it. Both need the password. */
export const setEmailApproval = async (actor: Actor, enabled: boolean, password: string) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
  const policy = await approvalPolicy(user);
  if (!enabled && policy.required) throw forbidden('Email approval is required for your role');
  if (enabled && !policy.configured) throw serviceUnavailable('Email approval is not set up on this server, so it cannot be turned on yet.', 'EMAIL_NOT_CONFIGURED');
  await checkOwnPassword(user, password);
  if (user.emailApprovalEnabled === enabled) return;

  // Turning it on proves the address works first, so a typo cannot lock the user out.
  const notice = { to: user.email, subject: `Email sign-in approval turned ${enabled ? 'on' : 'off'}`, text: `Email sign-in approval was turned ${enabled ? 'on' : 'off'} for your account (${user.email}). If this was not you, ask your manager to reset your password.` };
  try {
    await sendEmail(notice);
  } catch (err) {
    logger.error(`Security notice email failed: ${describeEmailError(err)}`);
    if (enabled) throw serviceUnavailable("We couldn't send a test email to your address, so approval was not turned on. Check the address with your manager.", 'EMAIL_DELIVERY_FAILED');
  }
  await prisma.user.update({ where: { id: user.id }, data: { emailApprovalEnabled: enabled } });
  await audit(prisma, actor, { action: enabled ? 'EMAIL_APPROVAL_ENABLED' : 'EMAIL_APPROVAL_DISABLED', entity: 'User', entityId: user.id });
};
