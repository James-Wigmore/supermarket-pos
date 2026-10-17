import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { DEFAULT_SETTINGS, saveSettings } from '../src/lib/settings';
import { recoverAccount } from '../src/services/recovery.service';
import { PASSWORD, app, auth, createUserIn, createWorld, linkIn, loginRaw, withEmail } from './helpers';

type World = Awaited<ReturnType<typeof createWorld>>;
let w: World;
let mail: ReturnType<typeof withEmail>;
beforeEach(async () => { w = await createWorld(); mail = withEmail(); });
afterEach(() => mail.restore());

const require_ = (roles: string[]) => saveSettings({ ...DEFAULT_SETTINGS, loginApprovalRequiredRoles: roles as never });

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
});

describe('who must use email approval is a setting only the super admin controls', () => {
  it('can be changed by a super admin and not by a manager, and the change is audited', async () => {
    const current = (await request(app).get('/api/settings').set(auth(w.users.MANAGER.token))).body;
    expect(current.loginApprovalRequiredRoles).toEqual([]);
    const next = { ...current, loginApprovalRequiredRoles: ['SUPER_ADMIN', 'MANAGER', 'CASHIER'] };
    expect((await request(app).put('/api/settings').set(auth(w.users.MANAGER.token)).send(next)).status).toBe(403);
    expect((await request(app).put('/api/settings').set(auth(w.users.SUPER_ADMIN.token)).send(next)).status).toBe(200);
    expect((await loginRaw(w.users.CASHIER.email)).body).toMatchObject({ nextStep: 'emailApproval' });
    expect(await prisma.auditLog.count({ where: { action: 'LOGIN_APPROVAL_POLICY_CHANGE', userId: w.users.SUPER_ADMIN.id } })).toBe(1); // the audit log is shared by all tests
  });

  it('keeps honouring the old twoFactorRequiredRoles value so nobody is weakened by the upgrade', async () => {
    const old: Partial<typeof DEFAULT_SETTINGS> = { ...DEFAULT_SETTINGS };
    delete old.loginApprovalRequiredRoles;
    await saveSettings({ ...old, twoFactorRequiredRoles: ['CASHIER'] } as never);
    expect((await loginRaw(w.users.CASHIER.email)).body.nextStep).toBe('emailApproval');
    expect((await loginRaw(w.users.MANAGER.email)).body.token).toBeTruthy();
  });
});

describe('a wrong email address cannot lock someone out', () => {
  const change = (token: string, id: string, email: string) => request(app).patch(`/api/users/${id}/email`).set(auth(token)).send({ email });

  it('lets a manager correct a cashier’s email: signs them out, cancels pending approvals, sends the next one to the new address', async () => {
    await require_(['CASHIER']);
    expect((await loginRaw(w.users.CASHIER.email)).body.nextStep).toBe('emailApproval');
    const staleLink = linkIn(mail.outbox[0]!, 'approve');

    expect((await change(w.users.MANAGER.token, w.users.CASHIER.id, 'Right@Shop.test')).status).toBe(204);
    expect((await request(app).get('/api/auth/me').set(auth(w.users.CASHIER.token))).status).toBe(401);
    expect((await request(app).get(`${staleLink.path}?token=${staleLink.token}`)).status).toBe(410);
    expect(await prisma.auditLog.count({ where: { action: 'USER_EMAIL_CHANGE', entityId: w.users.CASHIER.id } })).toBe(1);

    expect((await loginRaw('right@shop.test')).body.nextStep).toBe('emailApproval');
    expect(mail.outbox.at(-1)!.to).toBe('right@shop.test');
  });

  it('refuses changing your own email, a peer’s, a super admin’s or an address already in use', async () => {
    const peer = await createUserIn('MANAGER', w.branch.id, 'peer');
    expect((await change(w.users.MANAGER.token, w.users.MANAGER.id, 'mine@shop.test')).status).toBe(403);
    expect((await change(w.users.MANAGER.token, peer.id, 'peer@shop.test')).status).toBe(403);
    expect((await change(w.users.MANAGER.token, w.users.SUPER_ADMIN.id, 'boss@shop.test')).status).toBe(403);
    expect((await change(w.users.MANAGER.token, w.users.CASHIER.id, w.users.AUDITOR.email)).status).toBe(409);
    expect((await change(w.users.CASHIER.token, w.users.AUDITOR.id, 'x@shop.test')).status).toBe(403);
    expect((await change(w.users.SUPER_ADMIN.token, w.users.MANAGER.id, 'm2@shop.test')).status).toBe(204);
  });
});

describe('password changes and resets cancel pending sign-ins', () => {
  const pending = async () => {
    await require_(['CASHIER']);
    expect((await loginRaw(w.users.CASHIER.email)).body.nextStep).toBe('emailApproval');
    return linkIn(mail.outbox.at(-1)!, 'approve');
  };
  const approve = (link: { path: string; token: string }) => request(app).post(link.path).type('form').send({ token: link.token });

  it('cancels a pending approval when a manager resets the password', async () => {
    const link = await pending();
    expect((await request(app).post(`/api/users/${w.users.CASHIER.id}/password`).set(auth(w.users.MANAGER.token)).send({ password: 'BrandNewPass1!' })).status).toBe(204);
    expect((await approve(link)).status).toBe(410);
    expect(await prisma.auditLog.count({ where: { action: 'LOGIN_APPROVAL_CANCELLED', userId: w.users.MANAGER.id, after: { path: '$.reason', equals: 'password reset' } } })).toBe(1);
  });

  it('cancels a pending approval when the user is deactivated', async () => {
    const link = await pending();
    expect((await request(app).patch(`/api/users/${w.users.CASHIER.id}`).set(auth(w.users.MANAGER.token)).send({ isActive: false })).status).toBe(200);
    expect((await approve(link)).status).toBe(410);
  });

  it('cancels a pending approval when a manager changes their own password', async () => {
    const manager = await createUserIn('MANAGER', w.branch.id, 'cp'); // signed in before approval became mandatory
    await require_(['MANAGER']);
    const other = await loginRaw(manager.email);
    expect(other.body.nextStep).toBe('emailApproval');
    const link = linkIn(mail.outbox.at(-1)!, 'approve');
    const changed = await request(app).post('/api/auth/change-password').set(auth(manager.token)).send({ currentPassword: PASSWORD, newPassword: 'AnotherPass456!' });
    expect(changed.status).toBe(200);
    expect((await approve(link)).status).toBe(410);
  });
});

describe('last-resort recovery of a locked-out account (command line, on the PC with the database)', () => {
  it('signs the user out, can set a password and correct the email, cancels approvals and is audited', async () => {
    await require_(['SUPER_ADMIN']);
    expect((await loginRaw(w.users.SUPER_ADMIN.email)).body.nextStep).toBe('emailApproval');

    await recoverAccount(w.users.SUPER_ADMIN.email.toUpperCase(), { newPassword: 'RecoveredPass1!', newEmail: 'Owner@Right.test' });
    expect((await request(app).get('/api/auth/me').set(auth(w.users.SUPER_ADMIN.token))).status).toBe(401);
    expect((await loginRaw('owner@right.test')).status).toBe(401); // old password no longer works
    expect((await loginRaw('owner@right.test', 'RecoveredPass1!')).body.nextStep).toBe('emailApproval'); // still protected
    expect(mail.outbox.at(-1)!.to).toBe('owner@right.test');
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'ACCOUNT_RECOVERY', entityId: w.users.SUPER_ADMIN.id } });
    expect(JSON.stringify(log)).not.toContain('RecoveredPass1!');
    await expect(recoverAccount('nobody@nowhere.test')).rejects.toThrow(/not found/i);
    await expect(recoverAccount('owner@right.test', { newEmail: w.users.AUDITOR.email })).rejects.toThrow(/already uses/i);
  });

  it('switches off optional approval for a user who lost their mailbox', async () => {
    await prisma.user.update({ where: { id: w.users.CASHIER.id }, data: { emailApprovalEnabled: true } });
    expect((await loginRaw(w.users.CASHIER.email)).body.nextStep).toBe('emailApproval');
    await recoverAccount(w.users.CASHIER.email, { emailApprovalOff: true });
    expect((await loginRaw(w.users.CASHIER.email)).body.token).toBeTruthy();
  });
});
