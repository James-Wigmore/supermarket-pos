import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app, auth, resetDb } from './helpers';

const setup = {
  businessName: 'Corner Shop',
  currency: 'usd',
  branch: { name: 'Main Branch' },
  registers: ['Front', 'Back'],
  admin: { name: 'Owner', email: 'Owner@Shop.test', password: 'a-strong-passphrase' },
};

describe('first-run setup', () => {
  beforeEach(resetDb);

  it('creates the store and the owner account, and can only run once', async () => {
    expect((await request(app).get('/api/setup/status')).body).toEqual({ needsSetup: true });

    expect((await request(app).post('/api/setup').send(setup)).status).toBe(201);
    const login = await request(app).post('/api/auth/login').send({ email: 'owner@shop.test', password: setup.admin.password });
    expect(login.body.user).toMatchObject({ email: 'owner@shop.test', role: 'SUPER_ADMIN' });

    expect((await request(app).get('/api/setup/status')).body).toEqual({ needsSetup: false });
    const settings = await request(app).get('/api/settings').set(auth(login.body.token));
    expect(settings.body).toMatchObject({ currency: 'USD', receipt: { storeName: 'Corner Shop' } });
    const registers = await request(app).get('/api/registers').set(auth(login.body.token));
    expect(registers.body.data).toHaveLength(2);

    expect((await request(app).post('/api/setup').send(setup)).status).toBe(409);
  });

  it('rejects duplicate register names', async () => {
    const res = await request(app).post('/api/setup').send({ ...setup, registers: ['Front', 'front'] });
    expect(res.status).toBe(400);
  });
});
