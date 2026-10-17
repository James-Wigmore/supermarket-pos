import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { app, auth, createWorld, makeProduct, stockOf } from './helpers';

let w: Awaited<ReturnType<typeof createWorld>>;
beforeAll(async () => {
  w = await createWorld();
});

const mgr = () => auth(w.users.MANAGER.token);
const createCategory = (name: string, token = w.users.MANAGER.token) => request(app).post('/api/categories').set(auth(token)).send({ name });

describe('categories', () => {
  it('creates a category that is immediately listed and usable on a product', async () => {
    const res = await createCategory('Frozen Foods');
    expect(res.status).toBe(201);
    const list = await request(app).get('/api/categories?search=frozen').set(mgr());
    expect(list.body.data.map((c: { name: string }) => c.name)).toContain('Frozen Foods');
    expect(list.body.data[0]._count.products).toBe(0);

    const product = await makeProduct(w);
    const patched = await request(app).patch(`/api/products/${product.id}`).set(mgr()).send({ categoryId: res.body.id });
    expect(patched.status).toBe(200);
    expect(patched.body.category.name).toBe('Frozen Foods');
    expect(await prisma.auditLog.count({ where: { action: 'CATEGORY_CREATE', entityId: res.body.id } })).toBe(1);
  });

  it('rejects duplicate names whatever the letter case or spacing', async () => {
    await createCategory('Dairy');
    for (const name of ['Dairy', 'dairy', 'DAIRY', '  Dairy  ']) expect((await createCategory(name)).status, name).toBe(409);
    const other = (await createCategory('Bakery')).body;
    expect((await request(app).patch(`/api/categories/${other.id}`).set(mgr()).send({ name: 'dairy' })).status).toBe(409);
    expect((await request(app).patch(`/api/categories/${other.id}`).set(mgr()).send({ name: 'BAKERY' })).status).toBe(200);
    expect((await createCategory('Fresh   Produce')).body.name).toBe('Fresh Produce');
    expect((await createCategory('fresh produce')).status).toBe(409);
  });

  it('edits a category and shows the new name on its products', async () => {
    const category = (await createCategory('Drinks')).body;
    const product = await makeProduct(w);
    await request(app).patch(`/api/products/${product.id}`).set(mgr()).send({ categoryId: category.id });
    const res = await request(app).patch(`/api/categories/${category.id}`).set(mgr()).send({ name: 'Beverages' });
    expect(res.body.name).toBe('Beverages');
    expect((await request(app).get(`/api/products/${product.id}`).set(mgr())).body.category.name).toBe('Beverages');
  });

  it('refuses to delete a category that still has products, until they are reassigned', async () => {
    const category = (await createCategory('Snacks')).body;
    const spare = (await createCategory('Sweets')).body;
    const product = await makeProduct(w);
    await request(app).patch(`/api/products/${product.id}`).set(mgr()).send({ categoryId: category.id });

    const blocked = await request(app).delete(`/api/categories/${category.id}`).set(mgr());
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toMatch(/1 product/);
    expect(await prisma.category.count({ where: { id: category.id } })).toBe(1);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).categoryId).toBe(category.id);

    await request(app).patch(`/api/products/${product.id}`).set(mgr()).send({ categoryId: spare.id });
    expect((await request(app).delete(`/api/categories/${category.id}`).set(mgr())).status).toBe(204);
    expect(await prisma.auditLog.count({ where: { action: 'CATEGORY_DELETE', entityId: category.id } })).toBe(1);
  });

  it('keeps existing permissions: stock officers manage, cashiers and auditors only read', async () => {
    expect((await createCategory('Officer Made', w.users.STOCK_OFFICER.token)).status).toBe(201);
    for (const role of ['CASHIER', 'AUDITOR', 'ACCOUNTANT'] as const) {
      expect((await createCategory(`By ${role}`, w.users[role].token)).status, role).toBe(403);
    }
    expect((await request(app).get('/api/categories').set(auth(w.users.CASHIER.token))).status).toBe(200);
  });
});

describe('damaged stock report', () => {
  const damage = (productId: string, quantity: number, notes: string, type = 'DAMAGED', branchId?: string, token = w.users.MANAGER.token) =>
    request(app).post('/api/inventory/adjust').set(auth(token)).send({ productId, quantity, notes, type, branchId });
  const report = (query = '', token = w.users.MANAGER.token) => request(app).get(`/api/reports/damaged-stock${query}`).set(auth(token));

  it('values losses at cost price, not selling price, and lists every required column', async () => {
    w = await createWorld();
    const milk = await makeProduct(w, { name: 'Milk', cost: 600, price: 1000, stock: 20 });
    const rice = await makeProduct(w, { name: 'Rice', cost: 250, price: 900, stock: 20 });
    await damage(milk.id, 3, 'Dropped pallet');
    await damage(rice.id, 2, 'Water leak', 'DAMAGED', undefined, w.users.STOCK_OFFICER.token).then((r) => expect(r.status).toBe(403));
    await damage(rice.id, 2, 'Water leak');
    await damage(rice.id, 1, 'Went missing', 'LOSS');

    const res = await report();
    expect(res.status).toBe(200);
    expect(res.body.columns.map((c: { label: string }) => c.label)).toEqual(['Date', 'Product', 'Quantity damaged', 'Unit cost', 'Loss value', 'Branch', 'Reason', 'Recorded by']);
    expect(res.body.rows).toHaveLength(2);
    const byProduct = Object.fromEntries(res.body.rows.map((r: { product: string }) => [r.product, r]));
    expect(byProduct.Milk).toMatchObject({ quantity: 3, unitCost: 600, lossValue: 1800, branch: 'Main', reason: 'Dropped pallet', userName: 'MANAGER' });
    expect(byProduct.Rice).toMatchObject({ quantity: 2, unitCost: 250, lossValue: 500, reason: 'Water leak' });
  });

  it('keeps the cost recorded at the time even if the cost price changes later; older records use the current cost', async () => {
    const product = await makeProduct(w, { name: 'Oil', cost: 700, price: 1500, stock: 10 });
    await damage(product.id, 2, 'Cracked bottle');
    await prisma.product.update({ where: { id: product.id }, data: { purchasePrice: 900 } });
    await prisma.stockMovement.create({ data: { productId: product.id, branchId: w.branch.id, type: 'DAMAGED', quantity: -1, userId: w.users.MANAGER.id, notes: 'Legacy record' } });

    const rows = (await report('?reason=cracked')).body.rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].lossValue).toBe(1400);
    const legacy = (await report('?reason=legacy')).body.rows[0];
    expect(legacy).toMatchObject({ unitCost: 900, lossValue: 900 });
  });

  it('filters by reason, date and branch and keeps branches separate', async () => {
    const product = await makeProduct(w, { name: 'Soap', cost: 100, price: 300, stock: 10 });
    await damage(product.id, 1, 'Leaking bottle');
    await prisma.stockMovement.create({ data: { productId: product.id, branchId: w.other.id, type: 'DAMAGED', quantity: -4, unitCost: 100, userId: w.users.SUPER_ADMIN.id, notes: 'Other branch spill' } });

    expect((await report('?reason=LEAKING')).body.rows.map((r: { product: string }) => r.product)).toEqual(['Soap']);
    expect((await report('?reason=no-such-reason')).body.rows).toHaveLength(0);
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect((await report(`?from=${encodeURIComponent(future)}`)).body.rows).toHaveLength(0);

    const ownBranch = (await report()).body.rows;
    expect(ownBranch.every((r: { branch: string }) => r.branch === 'Main')).toBe(true);
    expect((await report(`?branchId=${w.other.id}`)).status).toBe(403);
    const admin = auth(w.users.SUPER_ADMIN.token);
    const otherRows = (await request(app).get(`/api/reports/damaged-stock?branchId=${w.other.id}`).set(admin)).body.rows;
    expect(otherRows).toHaveLength(1);
    expect(otherRows[0]).toMatchObject({ branch: 'Other', lossValue: 400, reason: 'Other branch spill' });
    const all = (await request(app).get('/api/reports/damaged-stock').set(admin)).body.rows;
    expect(new Set(all.map((r: { branch: string }) => r.branch))).toEqual(new Set(['Main', 'Other']));
  });

  it('follows the existing report permissions and export formats', async () => {
    for (const role of ['CASHIER', 'STOCK_OFFICER'] as const) expect((await report('', w.users[role].token)).status, role).toBe(403);
    for (const role of ['AUDITOR', 'ACCOUNTANT', 'MANAGER'] as const) expect((await report('', w.users[role].token)).status, role).toBe(200);
    for (const [format, type] of [['csv', 'text/csv'], ['xlsx', 'spreadsheetml'], ['pdf', 'application/pdf']] as const) {
      const res = await report(`?format=${format}`).buffer(true);
      expect(res.status, format).toBe(200);
      expect(res.headers['content-type']).toContain(type);
    }
  });
});

describe('receiving: branch for super admins', () => {
  const delivery = (token: string, productId: string, extra: object = {}) =>
    request(app).post('/api/purchases/deliveries').set(auth(token)).send({ supplierId: w.supplier.id, items: [{ productId, quantity: 5, unitCost: 100 }], ...extra });

  it('needs a branch from a super admin and books the stock into the chosen branch', async () => {
    const product = await makeProduct(w, { stock: 0 });
    const admin = w.users.SUPER_ADMIN.token;
    const missing = await delivery(admin, product.id);
    expect(missing.status).toBe(400);
    expect(missing.body.error.message).toMatch(/branch/i);

    const ok = await delivery(admin, product.id, { branchId: w.other.id });
    expect(ok.status).toBe(201);
    expect(await stockOf(product.id, w.other.id)).toBe(5);
    expect(await stockOf(product.id, w.branch.id)).toBe(0);
    expect((await prisma.purchase.findFirstOrThrow({ where: { id: ok.body.id } })).branchId).toBe(w.other.id);
  });

  it('keeps branch users on their own branch automatically', async () => {
    const product = await makeProduct(w, { stock: 0 });
    const officer = w.users.STOCK_OFFICER.token;
    expect((await delivery(officer, product.id)).status).toBe(201);
    expect(await stockOf(product.id, w.branch.id)).toBe(5);
    expect((await delivery(officer, product.id, { branchId: w.other.id })).status).toBe(403);
    expect(await stockOf(product.id, w.other.id)).toBe(0);
  });
});
