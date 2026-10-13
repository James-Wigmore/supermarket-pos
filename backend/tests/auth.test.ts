import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { createUserIn, PASSWORD, app, auth, createWorld, makeProduct } from './helpers';

let world: Awaited<ReturnType<typeof createWorld>>;
beforeAll(async () => {
  world = await createWorld();
});

describe('authentication', () => {
  it('logs in with valid credentials and records an audit entry', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: world.users.MANAGER.email, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.role).toBe('MANAGER');
    expect(res.body.user).not.toHaveProperty('passwordHash');
    expect(await prisma.auditLog.count({ where: { action: 'LOGIN', userId: world.users.MANAGER.id } })).toBeGreaterThan(0);
  });

  it('rejects wrong passwords and unknown users with the same message', async () => {
    const wrong = await request(app).post('/api/auth/login').send({ email: world.users.MANAGER.email, password: 'nope-nope' });
    const unknown = await request(app).post('/api/auth/login').send({ email: 'ghost@test.local', password: 'nope-nope' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it('requires a valid token', async () => {
    expect((await request(app).get('/api/products')).status).toBe(401);
    expect((await request(app).get('/api/products').set(auth('garbage'))).status).toBe(401);
  });

  it('invalidates tokens when the account is deactivated or the password changes', async () => {
    const own = await createUserIn('MANAGER', world.branch.id, 'pw'); // managers may change their own password; staff below them may not
    const res = await request(app).post('/api/auth/change-password').set(auth(own.token))
      .send({ currentPassword: PASSWORD, newPassword: 'AnotherPass456!' });
    expect(res.status).toBe(200);
    expect((await request(app).get('/api/auth/me').set(auth(own.token))).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set(auth(res.body.token))).status).toBe(200);

    await prisma.user.update({ where: { id: world.users.AUDITOR.id }, data: { isActive: false } });
    expect((await request(app).get('/api/auth/me').set(auth(world.users.AUDITOR.token))).status).toBe(401);
    await prisma.user.update({ where: { id: world.users.AUDITOR.id }, data: { isActive: true } });
  });
});

describe('authorization is enforced on the backend', () => {
  it('blocks cashiers from restricted operations', async () => {
    const product = await makeProduct(world, { stock: 10 });
    const t = auth(world.users.CASHIER.token);
    expect((await request(app).post('/api/products').set(t).send({ name: 'X', sellingPrice: 100 })).status).toBe(403);
    expect((await request(app).post(`/api/products/${product.id}/prices`).set(t).send({ newPrice: 1 })).status).toBe(403);
    expect((await request(app).delete(`/api/products/${product.id}`).set(t)).status).toBe(403);
    expect((await request(app).post('/api/inventory/adjust').set(t).send({ productId: product.id, type: 'LOSS', quantity: 1, notes: 'lost it' })).status).toBe(403);
    expect((await request(app).get('/api/users').set(t)).status).toBe(403);
    expect((await request(app).post('/api/users').set(t).send({ email: 'x@x.com', name: 'X', password: 'Password123!', role: 'MANAGER' })).status).toBe(403);
    expect((await request(app).get('/api/audit-logs').set(t)).status).toBe(403);
    expect((await request(app).get('/api/reports/financial').set(t)).status).toBe(403);
  });

  it('keeps auditors read-only', async () => {
    const t = auth(world.users.AUDITOR.token);
    expect((await request(app).get('/api/audit-logs').set(t)).status).toBe(200);
    expect((await request(app).get('/api/products').set(t)).status).toBe(200);
    expect((await request(app).post('/api/products').set(t).send({ name: 'X', sellingPrice: 100 })).status).toBe(403);
    expect((await request(app).post('/api/sessions').set(t).send({ registerId: world.register.id, openingCash: 0 })).status).toBe(403);
    expect((await request(app).post('/api/inventory/adjust').set(t)).status).toBe(403);
  });

  it('lets managers create cashiers but not super admins', async () => {
    const t = auth(world.users.MANAGER.token);
    const ok = await request(app).post('/api/users').set(t).send({ email: 'new.cashier@test.local', name: 'New', password: 'Password123!', role: 'CASHIER' });
    expect(ok.status).toBe(201);
    expect(ok.body.branchId).toBe(world.branch.id);
    const denied = await request(app).post('/api/users').set(t).send({ email: 'boss@test.local', name: 'Boss', password: 'Password123!', role: 'SUPER_ADMIN' });
    expect(denied.status).toBe(403);
    expect(await prisma.auditLog.count({ where: { action: 'USER_CREATE', entityId: ok.body.id } })).toBe(1);
  });

  it('audits role changes as permission changes', async () => {
    const t = auth(world.users.SUPER_ADMIN.token);
    const res = await request(app).patch(`/api/users/${world.users.STOCK_OFFICER.id}`).set(t).send({ role: 'MANAGER' });
    expect(res.status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: 'PERMISSION_CHANGE', entityId: world.users.STOCK_OFFICER.id } })).toBe(1);
    await request(app).patch(`/api/users/${world.users.STOCK_OFFICER.id}`).set(t).send({ role: 'STOCK_OFFICER' });
  });

  it('validates input with Zod', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('audit log immutability', () => {
  it('rejects updates and deletes at the database level', async () => {
    const entry = await prisma.auditLog.findFirstOrThrow();
    await expect(prisma.auditLog.update({ where: { id: entry.id }, data: { action: 'TAMPERED' } })).rejects.toThrow();
    await expect(prisma.auditLog.delete({ where: { id: entry.id } })).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe('DELETE FROM "AuditLog"')).rejects.toThrow();
  });
});

describe('cost price confidentiality', () => {
  it('hides purchase prices from cashiers but not from stock staff', async () => {
    const w = await createWorld();
    const product = await makeProduct(w, { cost: 650, price: 1000, barcode: '8000000000019' });
    const asCashier = await request(app).get('/api/products/lookup/8000000000019').set(auth(w.users.CASHIER.token));
    expect(asCashier.body.product.purchasePrice).toBeNull();
    expect(asCashier.body.product.price).toBeTruthy();
    const list = await request(app).get('/api/products?search=8000000000019').set(auth(w.users.CASHIER.token));
    expect(list.body.data[0].purchasePrice).toBeNull();
    const asStock = await request(app).get(`/api/products/${product.id}`).set(auth(w.users.STOCK_OFFICER.token));
    expect(Number(asStock.body.purchasePrice)).toBe(650);
    const quote = await request(app).post('/api/sales/quote').set(auth(w.users.CASHIER.token)).send({ items: [{ productId: product.id, quantity: 1 }] });
    expect(JSON.stringify(quote.body)).not.toContain('unitCost');
  });
});
