import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { PASSWORD, app, auth, createWorld, makeProduct, openShift, sellBody, stockOf } from './helpers';

let world: Awaited<ReturnType<typeof createWorld>>;
let session: string;
const cashier = () => auth(world.users.CASHIER.token);
const manager = { email: '', password: PASSWORD };

beforeAll(async () => {
  world = await createWorld();
  manager.email = world.users.MANAGER.email;
  session = await openShift(world);
});

const sell = (items: object[], payments: object[], extra: object = {}, token = world.users.CASHIER.token) =>
  request(app).post('/api/sales').set(auth(token)).send(sellBody(session, items, payments, extra));

describe('sales, payment, change and stock deduction', () => {
  it('completes a sale, computes change and reduces stock', async () => {
    const product = await makeProduct(world, { price: 2500, stock: 20, barcode: '5000000000017' });
    const res = await sell([{ productId: product.id, quantity: 3 }], [{ method: 'CASH', amount: 10000 }]);
    expect(res.status).toBe(201);
    expect(Number(res.body.total)).toBe(7500);
    expect(Number(res.body.changeGiven)).toBe(2500);
    expect(res.body.payments.map((p: { amount: string }) => Number(p.amount))).toEqual([7500]);
    expect(res.body.receiptNo).toMatch(/^RCT-\d{8}-\d{6}$/);
    expect(await stockOf(product.id, world.branch.id)).toBe(17);
    const movement = await prisma.stockMovement.findFirstOrThrow({ where: { referenceId: res.body.id } });
    expect(movement.type).toBe('SALE');
    expect(Number(movement.quantity)).toBe(-3);
    expect(movement.userId).toBe(world.users.CASHIER.id);
    expect(await prisma.auditLog.count({ where: { action: 'SALE', entityId: res.body.id } })).toBe(1);
  });

  it('supports split payments with mobile money and cash', async () => {
    const product = await makeProduct(world, { price: 4000, stock: 5 });
    const res = await sell([{ productId: product.id, quantity: 2 }], [{ method: 'MOBILE_MONEY', amount: 5000, reference: 'MM123' }, { method: 'CASH', amount: 4000 }]);
    expect(res.status).toBe(201);
    expect(Number(res.body.changeGiven)).toBe(1000);
    expect(res.body.payments.map((p: { method: string; amount: string }) => [p.method, Number(p.amount)]))
      .toEqual(expect.arrayContaining([['MOBILE_MONEY', 5000], ['CASH', 3000]]));
  });

  it('does not touch stock or create a sale when payment fails', async () => {
    const product = await makeProduct(world, { price: 1000, stock: 10 });
    const res = await sell([{ productId: product.id, quantity: 4 }], [{ method: 'CASH', amount: 3000 }]);
    expect(res.status).toBe(400);
    expect(await stockOf(product.id, world.branch.id)).toBe(10);
    expect(await prisma.saleItem.count({ where: { productId: product.id } })).toBe(0);
  });

  it('rolls back everything when any line has insufficient stock', async () => {
    const plenty = await makeProduct(world, { price: 1000, stock: 10 });
    const scarce = await makeProduct(world, { price: 1000, stock: 1 });
    const res = await sell([{ productId: plenty.id, quantity: 2 }, { productId: scarce.id, quantity: 2 }], [{ method: 'CASH', amount: 10000 }]);
    expect(res.status).toBe(409);
    expect(await stockOf(plenty.id, world.branch.id)).toBe(10);
    expect(await stockOf(scarce.id, world.branch.id)).toBe(1);
    expect(await prisma.stockMovement.count({ where: { productId: plenty.id, type: 'SALE' } })).toBe(0);
  });

  it('is idempotent: replaying a clientId never double-sells', async () => {
    const product = await makeProduct(world, { price: 1000, stock: 10 });
    const body = sellBody(session, [{ productId: product.id, quantity: 2 }], [{ method: 'CASH', amount: 2000 }], { offline: true });
    const [a, b] = await Promise.all([
      request(app).post('/api/sales').set(cashier()).send(body),
      request(app).post('/api/sales').set(cashier()).send(body),
    ]);
    const again = await request(app).post('/api/sales').set(cashier()).send(body);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(again.status).toBe(200);
    expect(again.body.duplicate).toBe(true);
    expect(await stockOf(product.id, world.branch.id)).toBe(8);
    expect(await prisma.sale.count({ where: { clientId: body.clientId } })).toBe(1);
  });

  it('ignores client-supplied prices without manager approval and prices from the catalogue', async () => {
    const product = await makeProduct(world, { price: 5000, stock: 5 });
    const denied = await sell([{ productId: product.id, quantity: 1, unitPrice: 100 }], [{ method: 'CASH', amount: 100 }]);
    expect(denied.status).toBe(403);
    const approved = await sell([{ productId: product.id, quantity: 1, unitPrice: 4000 }], [{ method: 'CASH', amount: 4000 }], { approval: manager });
    expect(approved.status).toBe(201);
    expect(Number(approved.body.total)).toBe(4000);
    expect(await prisma.auditLog.count({ where: { action: 'MANAGER_APPROVAL', userId: world.users.CASHIER.id } })).toBeGreaterThan(0);
    const wrong = await sell([{ productId: product.id, quantity: 1, unitPrice: 1000 }], [{ method: 'CASH', amount: 1000 }], { approval: { email: manager.email, password: 'wrong-wrong' } });
    expect(wrong.status).toBe(403);
  });
});

describe('discounts', () => {
  it('lets cashiers discount within their limit and audits it', async () => {
    const product = await makeProduct(world, { price: 10000, stock: 5 });
    const res = await sell([{ productId: product.id, quantity: 1, discountPercent: 5 }], [{ method: 'CASH', amount: 9500 }]);
    expect(res.status).toBe(201);
    expect(Number(res.body.discountTotal)).toBe(500);
    expect(await prisma.auditLog.count({ where: { action: 'DISCOUNT', entityId: res.body.id } })).toBe(1);
  });

  it('requires manager approval above the cashier limit', async () => {
    const product = await makeProduct(world, { price: 10000, stock: 5 });
    const items = [{ productId: product.id, quantity: 1, discountPercent: 20 }];
    expect((await sell(items, [{ method: 'CASH', amount: 8000 }])).status).toBe(403);
    const ok = await sell(items, [{ method: 'CASH', amount: 8000 }], { approval: manager });
    expect(ok.status).toBe(201);
    expect(Number(ok.body.total)).toBe(8000);
  });

  it('applies active promotions automatically (buy one get one)', async () => {
    const product = await makeProduct(world, { price: 1000, stock: 10 });
    await prisma.promotion.create({ data: { name: 'BOGO', type: 'BOGO', buyQty: 1, getQty: 1, productId: product.id, startsAt: new Date(Date.now() - 1000) } });
    const res = await sell([{ productId: product.id, quantity: 4 }], [{ method: 'CASH', amount: 2000 }]);
    expect(res.status).toBe(201);
    expect(Number(res.body.total)).toBe(2000);
  });
});

describe('price changes', () => {
  it('keeps history, schedules future prices and uses the effective price', async () => {
    const product = await makeProduct(world, { price: 5500, stock: 10 });
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    const mgr = auth(world.users.MANAGER.token);
    const res = await request(app).post(`/api/products/${product.id}/prices`).set(mgr).send({ newPrice: 5800, effectiveFrom: tomorrow, reason: 'Supplier increase' });
    expect(res.status).toBe(201);
    expect(Number(res.body.oldPrice)).toBe(5500);

    const now = await sell([{ productId: product.id, quantity: 1 }], [{ method: 'CASH', amount: 5500 }]);
    expect(Number(now.body.total)).toBe(5500);

    const history = await request(app).get(`/api/products/${product.id}/prices`).set(mgr);
    expect(history.body).toHaveLength(2);
    const quote = await request(app).post('/api/sales/quote').set(cashier()).send({ items: [{ productId: product.id, quantity: 2 }] });
    expect(Number(quote.body.total)).toBe(11000);
    expect(await prisma.auditLog.count({ where: { action: 'PRICE_CHANGE', entityId: product.id } })).toBe(1);
  });

  it('rejects past effective dates', async () => {
    const product = await makeProduct(world);
    const res = await request(app).post(`/api/products/${product.id}/prices`).set(auth(world.users.MANAGER.token))
      .send({ newPrice: 1, effectiveFrom: '2020-01-01T00:00:00Z' });
    expect(res.status).toBe(400);
  });
});

describe('voids and returns', () => {
  it('requires approval to void and restores stock exactly', async () => {
    const product = await makeProduct(world, { price: 1000, stock: 10 });
    const sale = await sell([{ productId: product.id, quantity: 4 }], [{ method: 'CASH', amount: 4000 }]);
    expect(await stockOf(product.id, world.branch.id)).toBe(6);

    const denied = await request(app).post(`/api/sales/${sale.body.id}/void`).set(cashier()).send({ reason: 'customer left' });
    expect(denied.status).toBe(403);
    const ok = await request(app).post(`/api/sales/${sale.body.id}/void`).set(cashier()).send({ reason: 'customer left', approval: manager });
    expect(ok.status).toBe(200);
    expect(await stockOf(product.id, world.branch.id)).toBe(10);
    expect(await prisma.auditLog.count({ where: { action: 'VOID', entityId: sale.body.id } })).toBe(1);
    expect((await request(app).post(`/api/sales/${sale.body.id}/void`).set(auth(world.users.MANAGER.token)).send({ reason: 'again' })).status).toBe(409);
  });

  it('creates a linked return, restocks and never alters the original sale total', async () => {
    const product = await makeProduct(world, { price: 3000, stock: 10 });
    const sale = await sell([{ productId: product.id, quantity: 3 }], [{ method: 'CASH', amount: 9000 }]);
    const itemId = sale.body.items[0].id;
    const body = { saleId: sale.body.id, reason: 'Damaged packaging', items: [{ saleItemId: itemId, quantity: 2 }] };

    expect((await request(app).post('/api/returns').set(cashier()).send(body)).status).toBe(403);
    const res = await request(app).post('/api/returns').set(cashier()).send({ ...body, approval: manager });
    expect(res.status).toBe(201);
    expect(Number(res.body.refundAmount)).toBe(6000);
    expect(res.body.saleId).toBe(sale.body.id);
    expect(await stockOf(product.id, world.branch.id)).toBe(9);

    const original = await prisma.sale.findUniqueOrThrow({ where: { id: sale.body.id } });
    expect(Number(original.total)).toBe(9000);
    expect(original.status).toBe('COMPLETED');

    const tooMany = await request(app).post('/api/returns').set(auth(world.users.MANAGER.token)).send({ ...body, items: [{ saleItemId: itemId, quantity: 2 }] });
    expect(tooMany.status).toBe(400);
    expect(await prisma.auditLog.count({ where: { action: 'REFUND', entityId: res.body.id } })).toBe(1);
  });
});

describe('cashier sessions', () => {
  it('closes with expected cash, actual cash and the variance', async () => {
    const w = await createWorld();
    const id = await openShift(w, 'CASHIER', 20000);
    const product = await makeProduct(w, { price: 1000, stock: 20 });
    const pay = (method: string, amount: number) =>
      request(app).post('/api/sales').set(auth(w.users.CASHIER.token)).send(sellBody(id, [{ productId: product.id, quantity: 5 }], [{ method, amount }]));
    expect((await pay('CASH', 5000)).status).toBe(201);
    expect((await pay('MOBILE_MONEY', 5000)).status).toBe(201);

    const summary = await request(app).get(`/api/sessions/${id}/summary`).set(auth(w.users.CASHIER.token));
    expect(Number(summary.body.expectedCash)).toBe(25000);
    expect(Number(summary.body.mobileMoney)).toBe(5000);

    const closed = await request(app).post(`/api/sessions/${id}/close`).set(auth(w.users.CASHIER.token)).send({ actualCash: 24500 });
    expect(closed.status).toBe(200);
    expect(Number(closed.body.difference)).toBe(-500);
    expect((await request(app).post('/api/sales').set(auth(w.users.CASHIER.token)).send(sellBody(id, [{ productId: product.id, quantity: 1 }], [{ method: 'CASH', amount: 1000 }]))).status).toBe(409);
  });

  it('allows only one open shift per cashier', async () => {
    const w = await createWorld();
    await openShift(w);
    const dup = await request(app).post('/api/sessions').set(auth(w.users.CASHIER.token)).send({ registerId: w.register.id, openingCash: 0 });
    expect(dup.status).toBe(409);
  });
});
