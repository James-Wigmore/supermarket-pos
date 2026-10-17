import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { businessToday } from '../src/lib/time';
import { PASSWORD, app, auth, createWorld, makeProduct, openShift, sellBody, stockOf } from './helpers';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

type World = Awaited<ReturnType<typeof createWorld>>;
const sell = (w: World, session: string, items: object[], payments: object[], extra: object = {}) =>
  request(app).post('/api/sales').set(auth(w.users.CASHIER.token)).send(sellBody(session, items, payments, extra));
const cash = (amount = 1000) => [{ method: 'CASH', amount }];

describe('voids and refunds cannot be driven by read-only roles', () => {
  it('rejects voids from auditors, accountants and stock officers even with manager credentials', async () => {
    const w = await createWorld();
    const product = await makeProduct(w, { stock: 5 });
    const sale = await sell(w, await openShift(w), [{ productId: product.id, quantity: 1 }], cash());
    const approval = { email: w.users.MANAGER.email, password: PASSWORD };
    for (const role of ['AUDITOR', 'ACCOUNTANT', 'STOCK_OFFICER'] as const) {
      expect((await request(app).post(`/api/sales/${sale.body.id}/void`).set(auth(w.users[role].token)).send({ reason: 'not allowed', approval })).status, role).toBe(403);
    }
    expect(await stockOf(product.id, w.branch.id)).toBe(4);
  });
});

describe('offline sales and shifts', () => {
  it('rejects back-dated or post-close sales but accepts late uploads of sales made during the shift', async () => {
    const w = await createWorld();
    const product = await makeProduct(w, { stock: 20 });
    const session = await openShift(w);
    await request(app).post(`/api/sessions/${session}/close`).set(auth(w.users.CASHIER.token)).send({ actualCash: 10000 });
    const { openedAt, closedAt } = await prisma.cashierSession.findUniqueOrThrow({ where: { id: session } });
    const at = (ms: number) => new Date(ms).toISOString();
    const items = [{ productId: product.id, quantity: 1 }];

    expect((await sell(w, session, items, cash())).status).toBe(409);
    expect((await sell(w, session, items, cash(), { offline: true, soldAt: at(closedAt!.getTime() + 1000) })).status).toBe(409);
    expect((await sell(w, session, items, cash(), { offline: true, soldAt: at(openedAt.getTime() - 3_600_000) })).status).toBe(400);
    expect((await sell(w, session, items, cash(), { offline: true, soldAt: at((openedAt.getTime() + closedAt!.getTime()) / 2) })).status).toBe(201);
  });
});

describe('quantities', () => {
  it('rejects tiny or over-precise quantities that would sell items for free', async () => {
    const w = await createWorld();
    const product = await makeProduct(w, { stock: 10 });
    const session = await openShift(w);
    for (const quantity of [0.0004, 0.0015, 0, -1]) {
      expect((await sell(w, session, [{ productId: product.id, quantity }], cash())).status, String(quantity)).toBe(400);
    }
    expect((await sell(w, session, [{ productId: product.id, quantity: 0.25 }], cash())).status).toBe(201);
  });
});

describe('expiry', () => {
  it('uses the store time zone for "today"', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-04T22:30:00Z')); // 01:30 on 5 Oct in Kampala
    expect(businessToday().toISOString().slice(0, 10)).toBe('2026-10-05');
    vi.setSystemTime(new Date('2026-10-04T20:30:00Z'));
    expect(businessToday().toISOString().slice(0, 10)).toBe('2026-10-04');
  });

  it('sells stock that expires today but never stock that expired yesterday', async () => {
    const w = await createWorld();
    const today = businessToday();
    const yesterday = new Date(today.getTime() - 86_400_000);
    const stale = await makeProduct(w, { expiry: yesterday, stock: 5 });
    const fresh = await makeProduct(w, { expiry: today, stock: 5 });
    const session = await openShift(w);
    expect((await sell(w, session, [{ productId: stale.id, quantity: 1 }], cash())).status).toBe(409);
    expect((await sell(w, session, [{ productId: fresh.id, quantity: 1 }], cash())).status).toBe(201);
  });

  it('keeps existing stock sellable when expiry tracking is switched on', async () => {
    const w = await createWorld();
    const product = await makeProduct(w, { stock: 10 });
    expect((await request(app).patch(`/api/products/${product.id}`).set(auth(w.users.MANAGER.token)).send({ tracksExpiry: true })).status).toBe(200);
    expect((await sell(w, await openShift(w), [{ productId: product.id, quantity: 3 }], cash(3000))).status).toBe(201);
    expect(Number((await prisma.productBatch.findFirstOrThrow({ where: { productId: product.id, batchNo: 'LEGACY' } })).quantity)).toBe(7);
  });
});

describe('expiry alerts on the dashboard', () => {
  it('counts batches expiring inside the configured window and batches already expired', async () => {
    const w = await createWorld();
    const day = (n: number) => new Date(businessToday().getTime() + n * 86_400_000);
    await makeProduct(w, { expiry: day(3), stock: 4 });
    await makeProduct(w, { expiry: day(60), stock: 4 });
    await makeProduct(w, { expiry: day(-2), stock: 4 });
    const mgr = auth(w.users.MANAGER.token);
    expect((await request(app).get('/api/dashboard').set(mgr)).body.expiry).toEqual({ windowDays: 30, expiringSoon: 1, expired: 1 });

    const settings = (await request(app).get('/api/settings').set(mgr)).body;
    await request(app).put('/api/settings').set(auth(w.users.SUPER_ADMIN.token)).send({ ...settings, expiryAlertDays: 90 });
    expect((await request(app).get('/api/dashboard').set(mgr)).body.expiry).toEqual({ windowDays: 90, expiringSoon: 2, expired: 1 });
  });
});

describe('receiving the same delivery twice', () => {
  it('treats a repeated clientRef as one delivery, even when requests race', async () => {
    const w = await createWorld();
    const product = await makeProduct(w, { stock: 0 });
    const body = { clientRef: randomUUID(), supplierId: w.supplier.id, items: [{ productId: product.id, quantity: 12, unitCost: 500 }] };
    const officer = auth(w.users.STOCK_OFFICER.token);
    const results = await Promise.all([1, 2, 3].map(() => request(app).post('/api/purchases/deliveries').set(officer).send(body)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 201]);
    expect(await stockOf(product.id, w.branch.id)).toBe(12);
    expect(await prisma.purchase.count({ where: { clientRef: body.clientRef } })).toBe(1);
  });
});

describe('registers can be renamed and retired', () => {
  it('lets a manager rename and deactivate a register, and a deactivated register cannot open a shift', async () => {
    const w = await createWorld();
    const mgr = auth(w.users.MANAGER.token);
    expect((await request(app).patch(`/api/registers/${w.register.id}`).set(mgr).send({ name: 'Front till' })).body.name).toBe('Front till');
    expect((await request(app).patch(`/api/registers/${w.register.id}`).set(auth(w.users.CASHIER.token)).send({ name: 'x' })).status).toBe(403);
    await request(app).patch(`/api/registers/${w.register.id}`).set(mgr).send({ isActive: false });
    const open = await request(app).post('/api/sessions').set(auth(w.users.CASHIER.token)).send({ registerId: w.register.id, openingCash: 0 });
    expect(open.status).toBe(404);
    expect(await prisma.auditLog.count({ where: { action: 'REGISTER_UPDATE', entityId: w.register.id } })).toBe(2);
  });
});

describe('abuse resistance', () => {
  it('returns 400 for unknown report options', async () => {
    const w = await createWorld();
    const mgr = auth(w.users.MANAGER.token);
    expect((await request(app).get('/api/reports/sales?groupBy=nonsense').set(mgr)).status).toBe(400);
    expect((await request(app).get('/api/reports/expiring?window=abc').set(mgr)).status).toBe(400);
  });

  it('does not audit failed logins for emails that do not exist', async () => {
    const before = await prisma.auditLog.count({ where: { action: 'LOGIN_FAILED' } });
    await request(app).post('/api/auth/login').send({ email: 'nobody@nowhere.test', password: 'whatever1' });
    expect(await prisma.auditLog.count({ where: { action: 'LOGIN_FAILED' } })).toBe(before);
  });

  it('only sends plain numeric barcodes to the online product service', async () => {
    const w = await createWorld();
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    for (const code of ['..%2F..%2Fsecret', 'ABC-123-XYZ']) await request(app).get(`/api/products/lookup/${code}?external=true`).set(auth(w.users.STOCK_OFFICER.token));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('caps held sales per cashier', async () => {
    const w = await createWorld();
    const statuses = [];
    for (let i = 0; i < 22; i++) statuses.push((await request(app).post('/api/sales/held').set(auth(w.users.CASHIER.token)).send({ payload: { items: [{ productId: randomUUID() }] } })).status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(20);
  });
});
