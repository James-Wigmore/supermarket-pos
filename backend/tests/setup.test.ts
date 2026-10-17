import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { app, auth, linkIn, resetDb, withEmail } from './helpers';

const setup = {
  businessName: 'Corner Shop',
  currency: 'usd',
  branch: { name: 'Main Branch' },
  registers: ['Front', 'Back'],
  admin: { name: 'Owner', email: 'Owner@Shop.test', password: 'a-strong-passphrase' },
};
const signIn = () => request(app).post('/api/auth/login').send({ email: 'owner@shop.test', password: setup.admin.password });

describe('first-run setup without email configured', () => {
  beforeEach(resetDb);

  it('creates the store and the owner account, warns that email approval is off, and can only run once', async () => {
    expect((await request(app).get('/api/setup/status')).body).toEqual({ needsSetup: true, emailApproval: false });

    expect((await request(app).post('/api/setup').send(setup)).status).toBe(201);
    const session = await signIn();
    expect(session.body.token).toBeTruthy(); // not locked out while email is not set up
    expect(session.body.user).toMatchObject({ email: 'owner@shop.test', role: 'SUPER_ADMIN' });
    expect(session.body.loginApproval).toMatchObject({ configured: false, enabled: false, required: true });
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: 'owner@shop.test' } });
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: 'LOGIN', userId: owner.id } })).after).toMatchObject({ emailApproval: 'OFF' }); // the audit log is shared by all tests

    expect((await request(app).get('/api/setup/status')).body).toEqual({ needsSetup: false, emailApproval: false });
    const settings = await request(app).get('/api/settings').set(auth(session.body.token));
    expect(settings.body).toMatchObject({ currency: 'USD', receipt: { storeName: 'Corner Shop' } });
    const registers = await request(app).get('/api/registers').set(auth(session.body.token));
    expect(registers.body.data).toHaveLength(2);

    expect((await request(app).post('/api/setup').send(setup)).status).toBe(409);
  });

  it('rejects duplicate register names', async () => {
    const res = await request(app).post('/api/setup').send({ ...setup, registers: ['Front', 'front'] });
    expect(res.status).toBe(400);
  });
});

describe('first-run setup with email configured', () => {
  let mail: ReturnType<typeof withEmail>;
  beforeEach(async () => { await resetDb(); mail = withEmail(); });
  afterEach(() => mail.restore());

  it('protects the owner’s first sign-in with email approval', async () => {
    expect((await request(app).get('/api/setup/status')).body).toEqual({ needsSetup: true, emailApproval: true });
    await request(app).post('/api/setup').send(setup);
    const first = await signIn();
    expect(first.body).toMatchObject({ nextStep: 'emailApproval' });
    expect(first.body.token).toBeUndefined();
    expect(mail.outbox[0]!.to).toBe('owner@shop.test');

    await request(app).post(linkIn(mail.outbox[0]!, 'approve').path).type('form').send({ token: linkIn(mail.outbox[0]!, 'approve').token });
    const done = await request(app).post('/api/auth/login/approval/complete').send({ requestToken: first.body.requestToken });
    expect(done.body.user).toMatchObject({ role: 'SUPER_ADMIN' });
  });
});
