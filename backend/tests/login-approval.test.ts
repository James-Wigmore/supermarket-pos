import { createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../src/config/env';
import { prisma } from '../src/lib/prisma';
import { DEFAULT_SETTINGS, saveSettings } from '../src/lib/settings';
import { CLAIM_GRACE_MS, sweepApprovals } from '../src/services/login-approval.service';
import { PASSWORD, app, auth, createWorld, linkIn, loginRaw, withEmail } from './helpers';

type World = Awaited<ReturnType<typeof createWorld>>;
let w: World;
let mail: ReturnType<typeof withEmail>;

beforeEach(async () => {
  w = await createWorld();
  mail = withEmail();
  await saveSettings({ ...DEFAULT_SETTINGS, loginApprovalRequiredRoles: ['SUPER_ADMIN', 'MANAGER'] });
});
afterEach(() => { mail.restore(); vi.useRealTimers(); });

const later = (ms: number) => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(Date.now() + ms)); };
const MINUTE = 60_000;

const post = (path: string, body: object) => request(app).post(`/api/auth/login/approval/${path}`).send(body);
const status = async (requestToken: string) => (await post('status', { requestToken })).body.status as string;
const complete = (requestToken: string) => post('complete', { requestToken });
const decide = (link: { path: string; token: string }) => request(app).post(link.path).type('form').send({ token: link.token });
const open = (link: { path: string; token: string }) => request(app).get(link.path).query({ token: link.token });

/** Password step for the manager; returns the browser's polling token and the two email links. */
const start = async (email = w.users.MANAGER.email) => {
  const res = await loginRaw(email);
  expect(res.status).toBe(200);
  const message = mail.outbox.at(-1)!;
  return { res, requestToken: res.body.requestToken as string, approve: linkIn(message, 'approve'), reject: linkIn(message, 'reject'), message };
};
/** The audit log is append-only and shared by all tests, so look only at entries about this test's users. */
const actions = async (action: string) =>
  prisma.auditLog.findMany({ where: { action, userId: { in: Object.values(w.users).map((u) => u.id) } }, orderBy: { createdAt: 'asc' } });

describe('who needs email approval', () => {
  it('stops required roles after the password, with no session, and emails the account owner', async () => {
    const { res, message } = await start();
    expect(res.body).toMatchObject({ nextStep: 'emailApproval', secondsLeft: 300, emailHint: 'm***@test.local' });
    expect(res.body.token).toBeUndefined();
    expect(res.body.user).toBeUndefined();
    expect(message.to).toBe(w.users.MANAGER.email);
    expect(message.text).toMatch(/\/api\/auth\/approve\?token=/);
    expect(message.text).toMatch(/\/api\/auth\/reject\?token=/);
    expect(message.html).toContain('Approve Login');
    expect(message.html).toContain('Reject Login');
  });

  it('lets other roles in with a password unless they opted in', async () => {
    expect((await loginRaw(w.users.CASHIER.email)).body.token).toBeTruthy();
    expect(mail.outbox).toHaveLength(0);
    await prisma.user.update({ where: { id: w.users.CASHIER.id }, data: { emailApprovalEnabled: true } });
    expect((await loginRaw(w.users.CASHIER.email)).body.nextStep).toBe('emailApproval');
  });

  it('does not reveal anything for a wrong password, and sends no email', async () => {
    expect((await loginRaw(w.users.MANAGER.email, 'wrong-password')).status).toBe(401);
    expect(mail.outbox).toHaveLength(0);
  });

  it('stores only hashes of the tokens, and no raw token or password reaches the audit log', async () => {
    const { requestToken, approve, reject } = await start();
    const row = await prisma.loginApproval.findFirstOrThrow();
    const sha = (v: string) => createHash('sha256').update(v).digest('hex');
    expect(row).toMatchObject({ approveTokenHash: sha(approve.token), rejectTokenHash: sha(reject.token), pollTokenHash: sha(requestToken) });
    const everything = JSON.stringify([row, await prisma.auditLog.findMany({ where: { userId: w.users.MANAGER.id } })]);
    for (const secret of [approve.token, reject.token, requestToken, PASSWORD]) expect(everything).not.toContain(secret);
    expect(new Set([approve.token, reject.token, requestToken]).size).toBe(3);
  });
});

describe('approval and session issuance', () => {
  it('issues a session only after the emailed link is approved, once, and audits it as an email approval', async () => {
    const { requestToken, approve } = await start();
    expect(await status(requestToken)).toBe('PENDING');
    expect((await complete(requestToken)).status).toBe(409); // not approved yet: no session

    const page = await open(approve); // opening the link changes nothing
    expect(page.status).toBe(200);
    expect(page.text).toContain('Approve Login');
    expect(page.headers['cache-control']).toBe('no-store');
    expect(await status(requestToken)).toBe('PENDING');

    const done = await decide(approve);
    expect(done.status).toBe(200);
    expect(done.text).toContain('Login approved');
    expect(await status(requestToken)).toBe('APPROVED');

    const session = await complete(requestToken);
    expect(session.status).toBe(200);
    expect(session.body).toMatchObject({ user: { email: w.users.MANAGER.email, role: 'MANAGER' }, loginApproval: { enabled: true, required: true, configured: true } });
    expect((await request(app).get('/api/auth/me').set(auth(session.body.token))).status).toBe(200);
    expect(await status(requestToken)).toBe('COMPLETED');

    expect((await actions('LOGIN_APPROVAL_REQUESTED'))).toHaveLength(1);
    expect((await actions('LOGIN_APPROVAL_APPROVED'))).toHaveLength(1);
    const login = (await actions('LOGIN')).at(-1)!;
    expect(login.after).toMatchObject({ method: 'email_approval' });
    expect(login.userId).toBe(w.users.MANAGER.id);
  });

  it('records where the request and the approval came from', async () => {
    const { approve } = await start();
    await request(app).post(approve.path).type('form').set('User-Agent', 'Phone/1.0').send({ token: approve.token });
    const entry = (await actions('LOGIN_APPROVAL_APPROVED'))[0]!;
    expect(entry.userAgent).toBe('Phone/1.0');
    expect(entry.after).toMatchObject({ requestedFromIp: expect.any(String), decidedFromIp: expect.any(String) });
  });

  it('refuses a status or complete call with an unknown token, without leaking anything', async () => {
    const res = await complete('x'.repeat(43));
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/user|email/i);
    expect((await post('status', { requestToken: 'short' })).status).toBe(400);
  });
});

describe('rejection', () => {
  it('stops the sign-in, cannot be turned into an approval later, and is audited', async () => {
    const { requestToken, approve, reject } = await start();
    expect((await open(reject)).text).toContain('Reject Login');
    expect((await decide(reject)).status).toBe(200);
    expect(await status(requestToken)).toBe('REJECTED');

    expect((await complete(requestToken)).status).toBe(403);
    expect((await decide(approve)).status).toBe(409); // the approve link of a rejected request is dead
    expect((await decide(reject)).status).toBe(409);
    expect(await status(requestToken)).toBe('REJECTED');
    expect((await actions('LOGIN_APPROVAL_REJECTED'))).toHaveLength(1);
    expect((await actions('LOGIN_APPROVAL_APPROVED'))).toHaveLength(0);
    expect((await actions('LOGIN')).filter((l) => (l.after as { method?: string }).method === 'email_approval')).toHaveLength(0);
  });
});

describe('expiry', () => {
  it('expires after five minutes: cannot be approved or completed, and is audited once', async () => {
    const { requestToken, approve } = await start();
    later(5 * MINUTE + 1000);
    expect(await status(requestToken)).toBe('EXPIRED');
    expect((await open(approve)).status).toBe(410);
    expect((await decide(approve)).status).toBe(410);
    expect((await complete(requestToken)).status).toBe(410);
    expect((await actions('LOGIN_APPROVAL_EXPIRED'))).toHaveLength(1);
    expect((await actions('LOGIN_APPROVAL_APPROVED'))).toHaveLength(0);
  });

  it('can still be approved just before it expires', async () => {
    const { requestToken, approve } = await start();
    later(5 * MINUTE - 5000);
    expect((await decide(approve)).status).toBe(200);
    expect((await complete(requestToken)).status).toBe(200);
  });

  it('gives an approved login a short grace period to be collected, then expires it', async () => {
    const first = await start();
    later(4 * MINUTE + 50_000);
    expect((await decide(first.approve)).status).toBe(200);
    later(MINUTE + 10_000); // the five minutes are over, the grace period is not
    expect((await complete(first.requestToken)).status).toBe(200);

    mail.outbox.length = 0;
    const second = await start(w.users.SUPER_ADMIN.email);
    expect((await decide(second.approve)).status).toBe(200);
    later(CLAIM_GRACE_MS + 1000);
    expect((await complete(second.requestToken)).status).toBe(410);
    expect(await status(second.requestToken)).toBe('EXPIRED');
  });

  it('is expired and audited by the clean-up job even if nobody looks', async () => {
    await start();
    later(6 * MINUTE);
    await sweepApprovals();
    expect((await prisma.loginApproval.findFirstOrThrow()).status).toBe('EXPIRED');
    expect((await actions('LOGIN_APPROVAL_EXPIRED'))).toHaveLength(1);
    await sweepApprovals();
    expect((await actions('LOGIN_APPROVAL_EXPIRED'))).toHaveLength(1);
  });
});

describe('replay attempts', () => {
  it('lets each link and each session claim be used once', async () => {
    const { requestToken, approve, reject } = await start();
    expect((await decide(approve)).status).toBe(200);
    expect((await decide(approve)).status).toBe(409);
    expect((await decide(reject)).status).toBe(409); // reject after approve
    expect((await complete(requestToken)).status).toBe(200);
    const again = await complete(requestToken);
    expect(again.status).toBe(409);
    expect(again.body.token).toBeUndefined();
    expect((await actions('LOGIN_APPROVAL_APPROVED'))).toHaveLength(1);
  });

  it('allows only one of two simultaneous collections to get a session', async () => {
    const { requestToken, approve } = await start();
    await decide(approve);
    const results = await Promise.all([complete(requestToken), complete(requestToken)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('cancels the older request when a new sign-in starts, so its links stop working', async () => {
    const first = await start();
    const second = await start();
    expect(await status(first.requestToken)).toBe('CANCELLED');
    expect((await decide(first.approve)).status).toBe(410);
    expect((await complete(first.requestToken)).status).toBe(410);
    expect((await decide(second.approve)).status).toBe(200);
    expect((await actions('LOGIN_APPROVAL_CANCELLED')).some((a) => (a.after as { reason?: string }).reason?.includes('newer'))).toBe(true);
  });
});

describe('unauthorized approval', () => {
  it('rejects invalid tokens and audits the attempt without storing the token', async () => {
    const res = await decide({ path: '/api/auth/approve', token: 'not-a-real-token-not-a-real-token' });
    expect(res.status).toBe(410);
    expect((await open({ path: '/api/auth/approve', token: '' })).status).toBe(410);
    const logged = JSON.stringify(await actions('LOGIN_APPROVAL_INVALID_LINK'));
    expect(logged).not.toContain('not-a-real-token');
  });

  it('does not let a reject link approve, the browser token approve, or an approve link reject', async () => {
    const { requestToken, approve, reject } = await start();
    expect((await decide({ path: approve.path, token: reject.token })).status).toBe(410);
    expect((await decide({ path: approve.path, token: requestToken })).status).toBe(410);
    expect((await decide({ path: reject.path, token: approve.token })).status).toBe(410);
    expect(await status(requestToken)).toBe('PENDING');
  });

  it('ties an approval to its own request: approving one user’s link never signs in another', async () => {
    const manager = await start();
    const admin = await start(w.users.SUPER_ADMIN.email);
    expect((await decide(manager.approve)).status).toBe(200);
    expect(await status(admin.requestToken)).toBe('PENDING');
    expect((await complete(admin.requestToken)).status).toBe(409);
    expect((await complete(manager.requestToken)).body.user.email).toBe(w.users.MANAGER.email);
  });

  it('refuses an approval once the account was deactivated or its password was reset', async () => {
    const { requestToken, approve } = await start();
    await prisma.user.update({ where: { id: w.users.MANAGER.id }, data: { tokenVersion: { increment: 1 } } }); // e.g. changed behind the app's back
    expect((await decide(approve)).status).toBe(410);
    expect(await status(requestToken)).toBe('CANCELLED');
  });

  it('refuses to hand over a session if the account changed after approval', async () => {
    const { requestToken, approve } = await start();
    await decide(approve);
    await prisma.user.update({ where: { id: w.users.MANAGER.id }, data: { isActive: false } });
    expect((await complete(requestToken)).status).toBe(410);
  });

  it('does not let one browser cancel or poll another user’s request without its token', async () => {
    const { requestToken } = await start();
    expect((await post('cancel', { requestToken: 'y'.repeat(43) })).status).toBe(404);
    expect(await status(requestToken)).toBe('PENDING');
  });

  it('never accepts a leftover two-factor challenge token as a session', async () => {
    const token = jwt.sign({ tv: 0, scope: 'challenge' }, env.JWT_SECRET, { subject: w.users.MANAGER.id, algorithm: 'HS256', expiresIn: 600 });
    expect((await request(app).get('/api/products').set(auth(token))).status).toBe(401);
  });

  it('escapes anything it prints on the approval pages', async () => {
    const res = await open({ path: '/api/auth/approve', token: '<script>alert(1)</script>' });
    expect(res.text).not.toContain('<script>alert');
  });
});

describe('cancelling', () => {
  it('lets the person cancel from the waiting screen; the email links then stop working', async () => {
    const { requestToken, approve } = await start();
    expect((await post('cancel', { requestToken })).body).toEqual({ status: 'CANCELLED' });
    expect(await status(requestToken)).toBe('CANCELLED');
    expect((await decide(approve)).status).toBe(410);
    expect((await complete(requestToken)).status).toBe(410);
    expect((await post('cancel', { requestToken })).body).toEqual({ status: 'CANCELLED' }); // harmless to repeat
    expect((await actions('LOGIN_APPROVAL_CANCELLED'))).toHaveLength(1);
  });

  it('can cancel even after approval, before collecting the session', async () => {
    const { requestToken, approve } = await start();
    await decide(approve);
    await post('cancel', { requestToken });
    expect((await complete(requestToken)).status).toBe(410);
  });
});

describe('email delivery failure', () => {
  it('answers 503 with a clear message, issues nothing, and audits the failure without secrets', async () => {
    const logins = (await actions('LOGIN')).length;
    Object.assign(env, { SMTP_USER: 'smtp-user', SMTP_PASS: 'super-secret-pass' });
    mail.failWith(Object.assign(new Error('Invalid login for smtp-user using super-secret-pass'), { code: 'EAUTH', responseCode: 535 }));
    const res = await loginRaw(w.users.MANAGER.email);
    expect(res.status).toBe(503);
    expect(res.body.error).toMatchObject({ code: 'EMAIL_DELIVERY_FAILED' });
    expect(res.body.error.message).toMatch(/couldn't send the approval email/i);
    expect(res.body.token).toBeUndefined();

    const row = await prisma.loginApproval.findFirstOrThrow();
    expect(row.status).toBe('FAILED');
    const failure = (await actions('LOGIN_APPROVAL_EMAIL_FAILED'))[0]!;
    expect(failure.after).toMatchObject({ reason: expect.stringContaining('EAUTH') });
    expect(JSON.stringify(await prisma.auditLog.findMany({ where: { userId: w.users.MANAGER.id } }))).not.toContain('super-secret-pass');
    expect(JSON.stringify(res.body)).not.toContain('super-secret-pass');

    // the links of the failed attempt cannot be used, and the password alone still gives nothing
    const link = linkIn(mail.outbox[0]!, 'approve');
    expect((await decide(link)).status).toBe(410);
    expect((await actions('LOGIN')).length).toBe(logins); // no session was recorded
  });

  it('works again as soon as the mail server does', async () => {
    mail.failWith(new Error('connect ECONNREFUSED'));
    expect((await loginRaw(w.users.MANAGER.email)).status).toBe(503);
    mail.restore();
    mail = withEmail();
    expect((await loginRaw(w.users.MANAGER.email)).body.nextStep).toBe('emailApproval');
  });
});

describe('rate limits', () => {
  it('limits approval emails per account', async () => {
    for (let i = 0; i < 3; i++) expect((await loginRaw(w.users.MANAGER.email)).status).toBe(200);
    const blocked = await loginRaw(w.users.MANAGER.email);
    expect(blocked.status).toBe(429);
    expect(mail.outbox).toHaveLength(3);
    later(11 * MINUTE);
    expect((await loginRaw(w.users.MANAGER.email)).status).toBe(200);
  });

  it('limits approval emails per address across accounts', async () => {
    await prisma.user.updateMany({ data: { emailApprovalEnabled: true } });
    const roles = ['MANAGER', 'SUPER_ADMIN', 'CASHIER', 'STOCK_OFFICER', 'ACCOUNTANT', 'AUDITOR'] as const;
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await loginRaw(w.users[roles[i % roles.length]!].email)).status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(10);
    expect(statuses.filter((s) => s === 429)).toHaveLength(2);
  });

  it('stops an address that keeps guessing tokens', async () => {
    let last = 0;
    for (let i = 0; i < 21; i++) last = (await complete(`guess-${i}-`.padEnd(43, 'z'))).status;
    expect(last).toBe(429);
  });

  it('limits how often one request can be polled', async () => {
    const { requestToken } = await start();
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await post('status', { requestToken })).status;
    expect(last).toBe(429);
  });
});

describe('email is not configured', () => {
  beforeEach(() => mail.restore());

  it('signs in with the password alone, and the session, the audit log and the setup status all say approval is OFF', async () => {
    const res = await loginRaw(w.users.MANAGER.email);
    expect(res.body.token).toBeTruthy();
    expect(res.body.loginApproval).toEqual({ configured: false, required: true, optedIn: false, enabled: false });
    const me = await request(app).get('/api/auth/me').set(auth(res.body.token));
    expect(me.body.loginApproval).toMatchObject({ configured: false, enabled: false });
    const login = (await actions('LOGIN')).at(-1)!;
    expect(login.after).toMatchObject({ method: 'password', emailApproval: 'OFF', wouldRequire: true });
    expect((await request(app).get('/api/setup/status')).body).toMatchObject({ emailApproval: false });
  });

  it('refuses to turn optional approval on, because it would not be running', async () => {
    const res = await request(app).post('/api/auth/email-approval').set(auth(w.users.CASHIER.token)).send({ enabled: true, password: PASSWORD });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('EMAIL_NOT_CONFIGURED');
  });
});

describe('opting in and out', () => {
  const toggle = (token: string, enabled: boolean, password = PASSWORD) => request(app).post('/api/auth/email-approval').set(auth(token)).send({ enabled, password });

  it('lets a cashier opt in with their password, after a test email, and out again', async () => {
    expect((await toggle(w.users.CASHIER.token, true, 'wrong-password')).status).toBe(400);
    expect((await toggle(w.users.CASHIER.token, true)).status).toBe(204);
    expect(mail.outbox.at(-1)).toMatchObject({ to: w.users.CASHIER.email });
    expect((await loginRaw(w.users.CASHIER.email)).body.nextStep).toBe('emailApproval');
    expect((await toggle(w.users.CASHIER.token, false)).status).toBe(204);
    expect((await loginRaw(w.users.CASHIER.email)).body.token).toBeTruthy();
    expect((await actions('EMAIL_APPROVAL_ENABLED'))).toHaveLength(1);
    expect((await actions('EMAIL_APPROVAL_DISABLED'))).toHaveLength(1);
  });

  it('does not turn it on when the test email cannot be delivered', async () => {
    mail.failWith(new Error('mailbox unavailable'));
    expect((await toggle(w.users.CASHIER.token, true)).status).toBe(503);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: w.users.CASHIER.id } })).emailApprovalEnabled).toBe(false);
  });

  it('does not let a role that requires approval switch it off', async () => {
    const session = await complete((await start()).requestToken); // still pending: nothing issued
    expect(session.status).toBe(409);
    const manager = { ...w.users.MANAGER };
    await saveSettings({ ...DEFAULT_SETTINGS, loginApprovalRequiredRoles: [] });
    const { token } = (await loginRaw(manager.email)).body;
    await saveSettings({ ...DEFAULT_SETTINGS, loginApprovalRequiredRoles: ['MANAGER'] });
    expect((await toggle(token, false)).status).toBe(403);
  });

  it('keeps users who had authenticator two-factor protected after the upgrade (migration marks them as opted in)', async () => {
    await prisma.user.update({ where: { id: w.users.CASHIER.id }, data: { emailApprovalEnabled: true } });
    expect((await loginRaw(w.users.CASHIER.email)).body.nextStep).toBe('emailApproval');
  });
});
