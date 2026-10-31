import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { app, auth, createWorld, makeProduct, openShift, sellBody } from './helpers';

let world: Awaited<ReturnType<typeof createWorld>>;
beforeAll(async () => {
  world = await createWorld();
});
afterEach(() => vi.unstubAllGlobals());

const lookup = (code: string, query = '', role: 'CASHIER' | 'STOCK_OFFICER' = 'STOCK_OFFICER') =>
  request(app).get(`/api/products/lookup/${code}${query}`).set(auth(world.users[role].token));

describe('product creation and barcode lookup', () => {
  it('creates a product with barcode aliases and an initial price history entry', async () => {
    const res = await request(app).post('/api/products').set(auth(world.users.STOCK_OFFICER.token))
      .send({ name: 'Peanut Butter 500g', sellingPrice: 8500, purchasePrice: 6000, barcodes: ['6009999000011', '6009999000028'] });
    expect(res.status).toBe(201);
    expect(res.body.barcodes).toHaveLength(2);
    expect(await prisma.priceHistory.count({ where: { productId: res.body.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'PRODUCT_CREATE', entityId: res.body.id } })).toBe(1);

    for (const code of ['6009999000011', '6009999000028']) {
      const found = await lookup(code);
      expect(found.body.source).toBe('internal');
      expect(found.body.product.id).toBe(res.body.id);
      expect(Number(found.body.product.price)).toBe(8500);
    }
  });

  it('rejects duplicate barcodes', async () => {
    const res = await request(app).post('/api/products').set(auth(world.users.STOCK_OFFICER.token))
      .send({ name: 'Copy', sellingPrice: 1, barcodes: ['6009999000011'] });
    expect(res.status).toBe(409);
  });

  it('generates internal EAN-13 barcodes that work exactly like manufacturer barcodes at the POS', async () => {
    const product = await makeProduct(world, { stock: 5, price: 1500 });
    const gen = await request(app).post(`/api/products/${product.id}/barcodes/generate`).set(auth(world.users.STOCK_OFFICER.token));
    expect(gen.status).toBe(201);
    const code = gen.body.code as string;
    expect(code).toMatch(/^20\d{11}$/);
    const checksum = [...code.slice(0, 12)].reduce((a, c, i) => a + Number(c) * (i % 2 ? 3 : 1), 0);
    expect((10 - (checksum % 10)) % 10).toBe(Number(code[12]));

    const posLookup = await lookup(code, '', 'CASHIER');
    expect(posLookup.body.product.id).toBe(product.id);
    const id = await openShift(world);
    const sale = await request(app).post('/api/sales').set(auth(world.users.CASHIER.token)).send(sellBody(id, [{ productId: product.id, quantity: 1 }], [{ method: 'CASH', amount: 1500 }]));
    expect(sale.status).toBe(201);

    const labels = await request(app).get(`/api/products/labels.pdf?ids=${product.id}&copies=2`).set(auth(world.users.STOCK_OFFICER.token));
    expect(labels.status).toBe(200);
    expect(labels.headers['content-type']).toContain('application/pdf');
  });

  it('generates distinct sequential internal barcodes', async () => {
    const a = await makeProduct(world);
    const b = await makeProduct(world);
    const t = auth(world.users.STOCK_OFFICER.token);
    const [x, y] = await Promise.all([request(app).post(`/api/products/${a.id}/barcodes/generate`).set(t), request(app).post(`/api/products/${b.id}/barcodes/generate`).set(t)]);
    expect(x.body.code).not.toBe(y.body.code);
  });
});

describe('external product information service', () => {
  const off = { status: 1, product: { product_name: 'Digestive Biscuits', brands: 'McVitie, Other', quantity: '400 g', image_url: 'https://img.test/a.jpg', categories: 'Snacks, Biscuits' } };

  it('suggests product details for unknown barcodes and caches them locally', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(off), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const first = await lookup('5012345678900', '?external=true');
    expect(first.body.source).toBe('external');
    expect(first.body.suggestion).toMatchObject({ name: 'Digestive Biscuits', brand: 'McVitie', packageSize: '400 g' });
    const second = await lookup('5012345678900', '?external=true');
    expect(second.body.source).toBe('external');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await prisma.externalProductCache.count({ where: { barcode: '5012345678900' } })).toBe(1);
  });

  it('never queries the service unless asked, and never for cashiers', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect((await lookup('4999999999995')).body.source).toBe('none');
    expect((await lookup('4999999999995', '?external=true', 'CASHIER')).body.source).toBe('none');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to manual creation when the service fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const res = await lookup('4888888888885', '?external=true');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ source: 'none', lookupFailed: true });
    const created = await request(app).post('/api/products').set(auth(world.users.STOCK_OFFICER.token))
      .send({ name: 'Manual item', sellingPrice: 1000, barcodes: ['4888888888885'] });
    expect(created.status).toBe(201);
  });
});

describe('reports and dashboard use real data', () => {
  it('reports sales, profit and exports in every format', async () => {
    const w = await createWorld();
    const product = await makeProduct(w, { price: 2000, cost: 1200, stock: 50 });
    const id = await openShift(w);
    for (let i = 0; i < 3; i++) {
      await request(app).post('/api/sales').set(auth(w.users.CASHIER.token)).send(sellBody(id, [{ productId: product.id, quantity: 2 }], [{ method: 'CASH', amount: 4000 }]));
    }
    const mgr = auth(w.users.MANAGER.token);
    const dash = await request(app).get('/api/dashboard').set(mgr);
    expect(dash.status).toBe(200);
    expect(dash.body.today.transactions).toBe(3);
    expect(dash.body.today.revenue).toBe(12000);
    expect(dash.body.today.grossProfit).toBe(4800);
    expect(dash.body.stockValue).toBe(44 * 1200);
    expect(dash.body.trend).toHaveLength(14);

    const fin = await request(app).get('/api/reports/financial').set(mgr);
    const row = (label: string) => fin.body.rows.find((r: { label: string }) => r.label === label).figure;
    expect(row('Revenue')).toBe(12000);
    expect(row('Cost of goods sold')).toBe(7200);
    expect(row('Gross profit')).toBe(4800);

    const byProduct = await request(app).get('/api/reports/sales?groupBy=product').set(mgr);
    expect(byProduct.body.rows[0]).toMatchObject({ label: expect.any(String), quantity: 6, revenue: 12000 });

    for (const [format, type] of [['csv', 'text/csv'], ['xlsx', 'spreadsheetml'], ['pdf', 'application/pdf']] as const) {
      const res = await request(app).get(`/api/reports/inventory-current?format=${format}`).set(mgr).buffer(true);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain(type);
    }
    expect((await request(app).get('/api/reports/cashier').set(mgr)).body.rows[0]).toMatchObject({ sales: 3, revenue: 12000 });
    expect((await request(app).get('/api/reports/low-stock').set(auth(w.users.ACCOUNTANT.token))).status).toBe(200);
  });
});
