import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { DEFAULT_SETTINGS, saveSettings } from '../src/lib/settings';
import { recoverAccount } from '../src/services/recovery.service';
import { PASSWORD, app, auth, codeFor, createUserIn, createWorld, enrol, loginRaw } from './helpers';

type World = Awaited<ReturnType<typeof createWorld>>;
let w: World;
beforeEach(async () => { w = await createWorld(); });
afterEach(() => vi.useRealTimers());

const require2fa = (roles: string[]) => saveSettings({ ...DEFAULT_SETTINGS, twoFactorRequiredRoles: roles as never });
const NEXT_STEP_MS = 30_000;
const later = (ms: number) => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(Date.now() + ms)); };

/** Signs the user in through the full two-step flow. */
const signIn = async (email: string, secret: string) => {
  const step1 = await loginRaw(email);
  return request(app).post('/api/auth/login/verify').send({ challengeToken: step1.body.challengeToken, code: codeFor(secret) });
};

describe('two-factor is required for admins and managers by default', () => {
  it('asks for enrolment instead of giving a session, and the enrolment token opens nothing else', async () => {
    await require2fa(['SUPER_ADMIN', 'MANAGER']);
    const res = await loginRaw(w.users.MANAGER.email);
    expect(res.body).toMatchObject({ nextStep: 'setup' });
    expect(res.body.token).toBeUndefined();
    expect((await request(app).get('/api/products').set(auth(res.body.setupToken))).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set(auth(res.body.setupToken))).status).toBe(401);
    expect((await loginRaw(w.users.CASHIER.email)).body.token).toBeTruthy(); // cashiers are not required
  });

  it('enrols with a first valid code, then signs in with password + code, storing nothing readable', async () => {
    await require2fa(['MANAGER']);
    const step1 = await loginRaw(w.users.MANAGER.email);
    const started = await request(app).post('/api/auth/2fa/setup').send({ setupToken: step1.body.setupToken });
    expect(started.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);

    const wrong = await request(app).post('/api/auth/2fa/confirm').send({ setupToken: step1.body.setupToken, code: '000000' });
    expect(wrong.status).toBe(400);
    const done = await request(app).post('/api/auth/2fa/confirm').send({ setupToken: step1.body.setupToken, code: codeFor(started.body.secret) });
    expect(done.status).toBe(200);
    expect(done.body.token).toBeTruthy();
    expect(done.body.recoveryCodes).toHaveLength(10);
    expect((await request(app).get('/api/products').set(auth(done.body.token))).status).toBe(200);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: w.users.MANAGER.id } });
    expect(row.twoFactorEnabled).toBe(true);
    expect(row.twoFactorSecret).not.toContain(started.body.secret);
    for (const code of done.body.recoveryCodes) expect(row.twoFactorRecovery).not.toContain(code.replace('-', ''));
    const everything = JSON.stringify(await prisma.auditLog.findMany());
    expect(everything).not.toContain(started.body.secret);
    expect(await prisma.auditLog.count({ where: { action: 'TWO_FACTOR_ENABLED', entityId: row.id } })).toBe(1);

    later(NEXT_STEP_MS); // the enrolment code is spent, so wait for the next one
    const second = await loginRaw(w.users.MANAGER.email);
    expect(second.body).toMatchObject({ nextStep: 'code' });
    expect(second.body.token).toBeUndefined();
    const ok = await request(app).post('/api/auth/login/verify').send({ challengeToken: second.body.challengeToken, code: codeFor(started.body.secret) });
    expect(ok.status).toBe(200);
    expect(ok.body.user.email).toBe(w.users.MANAGER.email);
  });
});

describe('codes cannot be reused or guessed', () => {
  const enrolled = async () => {
    await require2fa(['MANAGER']);
    const { secret, session } = await enrol((await loginRaw(w.users.MANAGER.email)).body.setupToken);
    return { secret, recoveryCodes: session.recoveryCodes as string[] };
  };

  it('rejects a code that was already used, even within its time window', async () => {
    const { secret } = await enrolled();
    later(NEXT_STEP_MS);
    expect((await signIn(w.users.MANAGER.email, secret)).status).toBe(200);
    expect((await signIn(w.users.MANAGER.email, secret)).status).toBe(401);
  });

  it('locks the account for a few minutes after repeated wrong codes, even for the right code', async () => {
    const { secret } = await enrolled();
    const step1 = await loginRaw(w.users.MANAGER.email);
    for (let i = 0; i < 5; i++) {
      expect((await request(app).post('/api/auth/login/verify').send({ challengeToken: step1.body.challengeToken, code: '123456' })).status).toBe(401);
    }
    later(NEXT_STEP_MS);
    const locked = await request(app).post('/api/auth/login/verify').send({ challengeToken: step1.body.challengeToken, code: codeFor(secret) });
    expect(locked.status).toBe(429);
  });

  it('accepts each recovery code once', async () => {
    const { recoveryCodes } = await enrolled();
    const code = recoveryCodes[0]!;
    const attempt = async (value: string) => request(app).post('/api/auth/login/verify').send({ challengeToken: (await loginRaw(w.users.MANAGER.email)).body.challengeToken, code: value });
    expect((await attempt(code.toLowerCase().replace('-', ' '))).status).toBe(200);
    expect((await attempt(code)).status).toBe(401);
    expect((await attempt(recoveryCodes[1]!)).status).toBe(200);
  });

  it('rejects a challenge token used as a session, and a session token used as a challenge', async () => {
    await enrolled();
    const challenge = (await loginRaw(w.users.MANAGER.email)).body.challengeToken;
    expect((await request(app).get('/api/products').set(auth(challenge))).status).toBe(401);
    const session = (await request(app).post('/api/auth/login/verify').send({ challengeToken: w.users.CASHIER.token, code: '123456' }));
    expect(session.status).toBe(401);
  });

  it('clears a secret that cannot be decrypted so the user can enrol again, and records it', async () => {
    await require2fa(['MANAGER']);
    await prisma.user.update({ where: { id: w.users.MANAGER.id }, data: { twoFactorEnabled: true, twoFactorSecret: 'broken.broken.broken' } });
    expect((await loginRaw(w.users.MANAGER.email)).body).toMatchObject({ nextStep: 'setup' });
    expect(await prisma.auditLog.count({ where: { action: 'TWO_FACTOR_RESET', entityId: w.users.MANAGER.id } })).toBe(1);
  });
});

describe('optional two-factor for other roles', () => {
  it('lets a cashier turn it on and off, but not for a role that requires it', async () => {
    const c = auth(w.users.CASHIER.token);
    const started = await request(app).post('/api/auth/2fa/setup').set(c).send({});
    expect((await request(app).post('/api/auth/2fa/confirm').set(c).send({ code: codeFor(started.body.secret) })).status).toBe(200);
    expect((await loginRaw(w.users.CASHIER.email)).body).toMatchObject({ nextStep: 'code' });
    expect((await request(app).post('/api/auth/2fa/setup').set(c).send({})).status).toBe(409);

    later(NEXT_STEP_MS);
    expect((await request(app).post('/api/auth/2fa/disable').set(c).send({ password: PASSWORD, code: '111111' })).status).toBe(400);
    expect((await request(app).post('/api/auth/2fa/disable').set(c).send({ password: PASSWORD, code: codeFor(started.body.secret) })).status).toBe(204);
    expect((await loginRaw(w.users.CASHIER.email)).body.token).toBeTruthy();

    await require2fa(['CASHIER']);
    const again = await request(app).post('/api/auth/2fa/setup').set(c).send({});
    await request(app).post('/api/auth/2fa/confirm').set(c).send({ code: codeFor(again.body.secret) });
    expect((await request(app).post('/api/auth/2fa/disable').set(c).send({ password: PASSWORD, code: '123456' })).status).toBe(403);
  });
});

describe('only a manager resets passwords of the people below them', () => {
  const reset = (token: string, id: string, password = 'BrandNewPass1!') => request(app).post(`/api/users/${id}/password`).set(auth(token)).send({ password });

  it('lets a manager reset every role below manager in their branch, signing the user out', async () => {
    for (const role of ['CASHIER', 'STOCK_OFFICER', 'ACCOUNTANT', 'AUDITOR'] as const) {
      const target = w.users[role];
      expect((await reset(w.users.MANAGER.token, target.id)).status, role).toBe(204);
      expect((await request(app).get('/api/auth/me').set(auth(target.token))).status, `${role} old session`).toBe(401);
      expect((await loginRaw(target.email, PASSWORD)).status, `${role} old password`).toBe(401);
      expect((await loginRaw(target.email, 'BrandNewPass1!')).body.token, `${role} new password`).toBeTruthy();
    }
    const logged = JSON.stringify(await prisma.auditLog.findMany({ where: { action: 'PASSWORD_RESET' } }));
    expect(logged).not.toContain('BrandNewPass1!');
    expect(await prisma.auditLog.count({ where: { action: 'PASSWORD_RESET' } })).toBe(4);
  });

  it('does not let a manager reset peers, super admins, themselves or another branch', async () => {
    const peer = await createUserIn('MANAGER', w.branch.id, 'peer');
    const otherCashier = await createUserIn('CASHIER', w.other.id, 'far');
    for (const target of [peer.id, w.users.SUPER_ADMIN.id, w.users.MANAGER.id, otherCashier.id]) {
      expect((await reset(w.users.MANAGER.token, target)).status, target).toBe(403);
    }
  });

  it('lets a super admin reset managers and staff anywhere, but nobody below a manager reset anything', async () => {
    const otherCashier = await createUserIn('CASHIER', w.other.id, 'far');
    expect((await reset(w.users.SUPER_ADMIN.token, w.users.MANAGER.id)).status).toBe(204);
    expect((await reset(w.users.SUPER_ADMIN.token, otherCashier.id)).status).toBe(204);
    expect((await reset(w.users.SUPER_ADMIN.token, w.users.SUPER_ADMIN.id)).status).toBe(403);
    for (const role of ['CASHIER', 'STOCK_OFFICER', 'ACCOUNTANT', 'AUDITOR'] as const) {
      expect((await reset(w.users[role].token, w.users.AUDITOR.id)).status, role).toBe(403);
    }
  });

  it('no longer changes a password through the general user edit', async () => {
    const res = await request(app).patch(`/api/users/${w.users.CASHIER.id}`).set(auth(w.users.MANAGER.token)).send({ name: 'Renamed', password: 'Sneaky12345!' });
    expect(res.status).toBe(200);
    expect((await loginRaw(w.users.CASHIER.email, 'Sneaky12345!')).status).toBe(401);
    expect((await loginRaw(w.users.CASHIER.email, PASSWORD)).status).toBe(200);
  });

  it('does not let staff below a manager change their own password; managers and admins still can', async () => {
    const body = { currentPassword: PASSWORD, newPassword: 'AnotherPass456!' };
    for (const role of ['CASHIER', 'STOCK_OFFICER', 'ACCOUNTANT', 'AUDITOR'] as const) {
      const res = await request(app).post('/api/auth/change-password').set(auth(w.users[role].token)).send(body);
      expect(res.status, role).toBe(403);
      expect(res.body.error.message).toMatch(/manager/i);
    }
    const manager = await createUserIn('MANAGER', w.branch.id, 'own');
    expect((await request(app).post('/api/auth/change-password').set(auth(manager.token)).send(body)).status).toBe(200);
  });

  it('asks for an authenticator code when a manager with 2FA changes their own password', async () => {
    const user = await createUserIn('MANAGER', w.branch.id, 'cp');
    const started = await request(app).post('/api/auth/2fa/setup').set(auth(user.token)).send({});
    const confirmed = await request(app).post('/api/auth/2fa/confirm').set(auth(user.token)).send({ code: codeFor(started.body.secret) });
    expect(confirmed.status).toBe(200);
    const body = { currentPassword: PASSWORD, newPassword: 'AnotherPass456!' };
    expect((await request(app).post('/api/auth/change-password').set(auth(user.token)).send(body)).status).toBe(400);
    later(NEXT_STEP_MS);
    expect((await request(app).post('/api/auth/change-password').set(auth(user.token)).send({ ...body, code: codeFor(started.body.secret) })).status).toBe(200);
  });
});

describe('resetting two-factor for a lost phone follows the same hierarchy', () => {
  it('lets a manager reset a cashier, who then signs in with a password again', async () => {
    const c = auth(w.users.CASHIER.token);
    const started = await request(app).post('/api/auth/2fa/setup').set(c).send({});
    await request(app).post('/api/auth/2fa/confirm').set(c).send({ code: codeFor(started.body.secret) });
    expect((await loginRaw(w.users.CASHIER.email)).body.nextStep).toBe('code');

    const url = `/api/users/${w.users.CASHIER.id}/two-factor/reset`;
    expect((await request(app).post(url).set(auth(w.users.MANAGER.token))).status).toBe(204);
    expect((await loginRaw(w.users.CASHIER.email)).body.token).toBeTruthy();
    expect(await prisma.auditLog.count({ where: { action: 'TWO_FACTOR_RESET', entityId: w.users.CASHIER.id } })).toBe(1);
  });

  it('refuses managers resetting other managers or admins, and staff resetting anyone', async () => {
    const peer = await createUserIn('MANAGER', w.branch.id, 'peer');
    for (const [token, id] of [[w.users.MANAGER.token, peer.id], [w.users.MANAGER.token, w.users.SUPER_ADMIN.id], [w.users.CASHIER.token, w.users.AUDITOR.id]]) {
      expect((await request(app).post(`/api/users/${id}/two-factor/reset`).set(auth(token!))).status).toBe(403);
    }
    expect((await request(app).post(`/api/users/${peer.id}/two-factor/reset`).set(auth(w.users.SUPER_ADMIN.token))).status).toBe(204);
  });
});

describe('who must use two-factor is a setting only the super admin controls', () => {
  it('can be changed by a super admin and not by a manager', async () => {
    const current = (await request(app).get('/api/settings').set(auth(w.users.MANAGER.token))).body;
    expect(current.twoFactorRequiredRoles).toEqual([]);
    const next = { ...current, twoFactorRequiredRoles: ['SUPER_ADMIN', 'MANAGER', 'CASHIER'] };
    expect((await request(app).put('/api/settings').set(auth(w.users.MANAGER.token)).send(next)).status).toBe(403);
    expect((await request(app).put('/api/settings').set(auth(w.users.SUPER_ADMIN.token)).send(next)).status).toBe(200);
    expect((await loginRaw(w.users.CASHIER.email)).body).toMatchObject({ nextStep: 'setup' });
  });
});

describe('last-resort recovery of a locked-out owner (command line, on the PC with the database)', () => {
  it('turns two-factor off, can set a new password, signs the user out and is audited', async () => {
    await require2fa(['SUPER_ADMIN']);
    const { secret } = await enrol((await loginRaw(w.users.SUPER_ADMIN.email)).body.setupToken);
    expect(secret).toBeTruthy();
    expect((await loginRaw(w.users.SUPER_ADMIN.email)).body.nextStep).toBe('code');

    await recoverAccount(w.users.SUPER_ADMIN.email.toUpperCase(), 'RecoveredPass1!');
    expect((await request(app).get('/api/auth/me').set(auth(w.users.SUPER_ADMIN.token))).status).toBe(401);
    expect((await loginRaw(w.users.SUPER_ADMIN.email)).status).toBe(401); // old password no longer works
    expect((await loginRaw(w.users.SUPER_ADMIN.email, 'RecoveredPass1!')).body.nextStep).toBe('setup'); // must enrol again
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'ACCOUNT_RECOVERY' } });
    expect(JSON.stringify(log)).not.toContain('RecoveredPass1!');
    await expect(recoverAccount('nobody@nowhere.test')).rejects.toThrow(/not found/i);
  });
});
