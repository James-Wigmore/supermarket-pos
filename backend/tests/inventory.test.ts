import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { app, auth, createUserIn, createWorld, makeProduct, openShift, sellBody, stockOf } from './helpers';

let world: Awaited<ReturnType<typeof createWorld>>;
const day = (n: number) => new Date(Date.now() + n * 86_400_000);

beforeAll(async () => {
  world = await createWorld();
});

describe('stock adjustments', () => {
  it('lets managers adjust stock with a reason, movement record and audit entry', async () => {
    const product = await makeProduct(world, { stock: 10 });
    const res = await request(app).post('/api/inventory/adjust').set(auth(world.users.MANAGER.token))
      .send({ productId: product.id, type: 'DAMAGED', quantity: 3, notes: 'Dropped pallet' });
    expect(res.status).toBe(201);
    expect(await stockOf(product.id, world.branch.id)).toBe(7);
    const movement = await prisma.stockMovement.findFirstOrThrow({ where: { productId: product.id, type: 'DAMAGED' } });
    expect(Number(movement.quantity)).toBe(-3);
    expect(movement.notes).toBe('Dropped pallet');
    expect(await prisma.auditLog.count({ where: { action: 'STOCK_ADJUST', entityId: product.id } })).toBe(1);
  });

  it('prevents negative stock unless management enables it', async () => {
    const product = await makeProduct(world, { stock: 2 });
    const body = { productId: product.id, type: 'LOSS', quantity: 5, notes: 'Theft suspected' };
    const mgr = auth(world.users.MANAGER.token);
    expect((await request(app).post('/api/inventory/adjust').set(mgr).send(body)).status).toBe(409);
    expect(await stockOf(product.id, world.branch.id)).toBe(2);

    await request(app).put('/api/settings').set(auth(world.users.SUPER_ADMIN.token)).send({
      allowNegativeStock: true, discountLimitPercent: { SUPER_ADMIN: 100, MANAGER: 50, CASHIER: 5, STOCK_OFFICER: 0, ACCOUNTANT: 0, AUDITOR: 0 },
      loyalty: { enabled: false, unitAmount: 1000 }, receipt: { storeName: 'Test', header: '', footer: '' }, expiryAlertDays: 30,
    });
    const id = await openShift(world);
    const sale = await request(app).post('/api/sales').set(auth(world.users.CASHIER.token)).send(sellBody(id, [{ productId: product.id, quantity: 5 }], [{ method: 'CASH', amount: 5000 }]));
    expect(sale.status).toBe(201);
    expect(await stockOf(product.id, world.branch.id)).toBe(-3);
  });
});

describe('expiry and batches (FEFO)', () => {
  it('sells from the earliest-expiring batch first and skips expired stock', async () => {
    const w = await createWorld();
    const product = await makeProduct(w, { expiry: day(30), stock: 10 });
    await request(app).post('/api/inventory/adjust').set(auth(w.users.MANAGER.token)).send({
      productId: product.id, type: 'ADJUSTMENT', direction: 'IN', quantity: 5, expiryDate: day(5).toISOString(), batchNo: 'SOON', notes: 'Delivery top-up',
    });
    await request(app).post('/api/inventory/adjust').set(auth(w.users.MANAGER.token)).send({
      productId: product.id, type: 'ADJUSTMENT', direction: 'IN', quantity: 4, expiryDate: day(-2).toISOString(), batchNo: 'OLD', notes: 'Old stock found',
    });

    const id = await openShift(w);
    const sale = await request(app).post('/api/sales').set(auth(w.users.CASHIER.token))
      .send(sellBody(id, [{ productId: product.id, quantity: 7 }], [{ method: 'CASH', amount: 7000 }]));
    expect(sale.status).toBe(201);
    const batches = await prisma.productBatch.findMany({ where: { productId: product.id } });
    const qty = (no: string) => Number(batches.find((b) => b.batchNo === no)?.quantity);
    expect(qty('SOON')).toBe(0);
    expect(qty('OLD')).toBe(4);
    expect(qty(`B-${day(30).toISOString().slice(0, 10)}`)).toBe(8);

    const expiring = await request(app).get('/api/inventory/batches?window=30').set(auth(w.users.MANAGER.token));
    expect(expiring.body.data.map((b: { batchNo: string }) => b.batchNo)).not.toContain('OLD');
    const expired = await request(app).get('/api/inventory/batches?window=expired').set(auth(w.users.MANAGER.token));
    expect(expired.body.data.map((b: { batchNo: string }) => b.batchNo)).toEqual(['OLD']);
  });
});

describe('purchasing and fast receiving', () => {
  it('does not change stock for a purchase order, only when goods are received', async () => {
    const w = await createWorld();
    const product = await makeProduct(w, { stock: 5, cost: 600 });
    const mgr = auth(w.users.MANAGER.token);
    const po = await request(app).post('/api/purchases').set(mgr).send({ supplierId: w.supplier.id, items: [{ productId: product.id, quantity: 20, unitCost: 650 }] });
    expect(po.status).toBe(201);
    expect(await stockOf(product.id, w.branch.id)).toBe(5);

    const detail = await request(app).get(`/api/purchases/${po.body.id}`).set(mgr);
    const itemId = detail.body.items[0].id;
    const over = await request(app).post(`/api/purchases/${po.body.id}/receive`).set(auth(w.users.STOCK_OFFICER.token)).send({ items: [{ itemId, quantity: 25 }] });
    expect(over.status).toBe(400);

    const received = await request(app).post(`/api/purchases/${po.body.id}/receive`).set(auth(w.users.STOCK_OFFICER.token)).send({ items: [{ itemId, quantity: 20, unitCost: 700 }] });
    expect(received.status).toBe(200);
    expect(received.body.status).toBe('RECEIVED');
    expect(await stockOf(product.id, w.branch.id)).toBe(25);
    expect(Number((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).purchasePrice)).toBe(700);
    expect(Number((await prisma.supplier.findUniqueOrThrow({ where: { id: w.supplier.id } })).balance)).toBe(14000);
    expect(Number((await prisma.supplierPrice.findFirstOrThrow({ where: { productId: product.id } })).unitCost)).toBe(700);
    expect(await prisma.auditLog.count({ where: { action: 'STOCK_RECEIVE', entityId: po.body.id } })).toBe(1);

    const again = await request(app).post(`/api/purchases/${po.body.id}/receive`).set(auth(w.users.STOCK_OFFICER.token)).send({ items: [{ itemId, quantity: 1 }] });
    expect(again.status).toBe(409);
  });

  it('receives a whole scanned delivery in one transaction and remembers supplier prices', async () => {
    const w = await createWorld();
    const a = await makeProduct(w, { stock: 0, barcode: '7000000000012' });
    const milk = await makeProduct(w, { stock: 0, expiry: day(10) });
    const officer = auth(w.users.STOCK_OFFICER.token);

    const bad = await request(app).post('/api/purchases/deliveries').set(officer)
      .send({ supplierId: w.supplier.id, items: [{ productId: a.id, quantity: 12, unitCost: 500 }, { productId: milk.id, quantity: 6, unitCost: 2000 }] });
    expect(bad.status).toBe(400);
    expect(await stockOf(a.id, w.branch.id)).toBe(0);

    const ok = await request(app).post('/api/purchases/deliveries').set(officer).send({
      supplierId: w.supplier.id,
      items: [{ productId: a.id, quantity: 12, unitCost: 500 }, { productId: milk.id, quantity: 6, unitCost: 2000, batchNo: 'M1', expiryDate: day(10).toISOString() }],
    });
    expect(ok.status).toBe(201);
    expect(await stockOf(a.id, w.branch.id)).toBe(12);
    expect(await stockOf(milk.id, w.branch.id)).toBe(6);

    const lookup = await request(app).get(`/api/products/lookup/7000000000012?supplierId=${w.supplier.id}`).set(officer);
    expect(lookup.body.source).toBe('internal');
    expect(Number(lookup.body.product.supplierPrice)).toBe(500);
    expect(Number(lookup.body.product.stock)).toBe(12);
  });

  it('forbids cashiers from receiving stock', async () => {
    const w = await createWorld();
    const product = await makeProduct(w);
    const res = await request(app).post('/api/purchases/deliveries').set(auth(w.users.CASHIER.token))
      .send({ supplierId: w.supplier.id, items: [{ productId: product.id, quantity: 1, unitCost: 1 }] });
    expect(res.status).toBe(403);
  });
});

describe('multi-branch isolation', () => {
  it('keeps stock, sales and users separate per branch', async () => {
    const w = await createWorld();
    const product = await makeProduct(w, { stock: 10 });
    const otherManager = await createUserIn('MANAGER', w.other.id, '2');

    expect((await request(app).get(`/api/inventory?branchId=${w.branch.id}`).set(auth(otherManager.token))).status).toBe(403);
    const own = await request(app).get('/api/inventory').set(auth(otherManager.token));
    expect(Number(own.body.data.find((p: { id: string }) => p.id === product.id).quantity)).toBe(0);

    const adjust = await request(app).post('/api/inventory/adjust').set(auth(otherManager.token))
      .send({ productId: product.id, branchId: w.branch.id, type: 'LOSS', quantity: 1, notes: 'cross branch' });
    expect(adjust.status).toBe(403);
    expect(await stockOf(product.id, w.branch.id)).toBe(10);

    const id = await openShift(w);
    const sale = await request(app).post('/api/sales').set(auth(w.users.CASHIER.token)).send(sellBody(id, [{ productId: product.id, quantity: 1 }], [{ method: 'CASH', amount: 1000 }]));
    expect((await request(app).get(`/api/sales/${sale.body.id}`).set(auth(otherManager.token))).status).toBe(403);
    expect((await request(app).get('/api/sales').set(auth(otherManager.token))).body.data).toHaveLength(0);
    expect((await request(app).get('/api/users').set(auth(otherManager.token))).body.map((u: { id: string }) => u.id)).toEqual([otherManager.id]);

    const all = await request(app).get('/api/sales?branchId=' + w.branch.id).set(auth(w.users.SUPER_ADMIN.token));
    expect(all.body.data).toHaveLength(1);
  });

  it('transfers stock between branches with paired movements', async () => {
    const w = await createWorld();
    const product = await makeProduct(w, { stock: 10 });
    const res = await request(app).post('/api/inventory/transfer').set(auth(w.users.MANAGER.token)).send({ productId: product.id, toBranchId: w.other.id, quantity: 4 });
    expect(res.status).toBe(201);
    expect(await stockOf(product.id, w.branch.id)).toBe(6);
    expect(await stockOf(product.id, w.other.id)).toBe(4);
    expect(await prisma.stockMovement.count({ where: { reference: res.body.reference } })).toBe(2);
  });
});
