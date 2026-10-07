import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { decide } from '../src/sync/engine';
import { connectSpreadsheet, getStatus, resendAll, resolveConflict, runSync, useSheetsApi } from '../src/sync/runtime';
import { app, auth, createWorld, makeProduct, openShift, sellBody } from './helpers';
import { FakeSheets } from './fake-sheets';

let world: Awaited<ReturnType<typeof createWorld>>;
let sheets: FakeSheets;

const settle = async () => {
  for (let i = 0; i < 100 && (await getStatus()).running; i++) await new Promise((r) => setTimeout(r, 10));
  return runSync();
};
const stateOf = (entity: string, recordId: string) => prisma.syncState.findUniqueOrThrow({ where: { entity_recordId: { entity, recordId } } });

beforeEach(async () => {
  world = await createWorld();
  sheets = new FakeSheets();
  useSheetsApi(sheets);
  await connectSpreadsheet({ mode: 'create' });
  await settle();
});

const sellOne = async (productId: string) => {
  const session = await openShift(world);
  const res = await request(app).post('/api/sales').set(auth(world.users.CASHIER.token)).send(sellBody(session, [{ productId, quantity: 2 }], [{ method: 'CASH', amount: 5000 }]));
  expect(res.status).toBe(201);
  return res.body.id as string;
};

describe('Google Sheets synchronisation', () => {
  it('creates every worksheet and a readable administration guide', () => {
    expect([...sheets.tabs_.keys()]).toEqual(expect.arrayContaining(['ADMINISTRATION', 'Products', 'Sales', 'Sale_Items', 'Stock_Movements', 'Audit_Log', 'Sync_Log']));
    expect(sheets.tabs_.get('ADMINISTRATION')!.length).toBeGreaterThan(20);
  });

  it('sends a completed sale once and never duplicates it on later runs', async () => {
    const product = await makeProduct(world, { stock: 10, price: 2500 });
    const saleId = await sellOne(product.id);
    await settle();
    expect(sheets.find('Sales', saleId)).toBeTruthy();
    expect(sheets.table('Sale_Items').filter((row) => row[1] === saleId)).toHaveLength(1);
    expect(sheets.cell('Stock', `${product.id}:${world.branch.id}`, 'quantity')).toBe(8);

    const before = sheets.table('Sales').length;
    await settle();
    await prisma.syncState.updateMany({ data: { status: 'PENDING' } }); // simulate "sent, but we never recorded it"
    await settle();
    expect(sheets.table('Sales')).toHaveLength(before);
    expect((await getStatus()).pending).toBe(0);
  });

  it('keeps sales safe locally while offline and sends them when the connection returns', async () => {
    const product = await makeProduct(world, { stock: 10 });
    const saleId = await sellOne(product.id);
    sheets.failNext = 'offline';
    expect((await settle()).skipped).toBe('offline');
    expect((await getStatus()).online).toBe(false);
    expect(await prisma.sale.count({ where: { id: saleId } })).toBe(1);
    expect(sheets.find('Sales', saleId)).toBeUndefined();
    expect((await getStatus()).failed).toBe(0);
    expect((await getStatus()).pending).toBeGreaterThan(0);

    expect((await settle()).ok).toBe(true);
    expect(sheets.find('Sales', saleId)).toBeTruthy();
    expect((await getStatus())).toMatchObject({ online: true, pending: 0, failed: 0 });
  });

  it('marks records failed when Google rejects them and retries them later', async () => {
    const product = await makeProduct(world, { stock: 10 });
    const saleId = await sellOne(product.id);
    sheets.failNext = 'rejected';
    await settle();
    const failed = await prisma.syncState.findMany({ where: { status: 'FAILED' } });
    expect(failed.length).toBeGreaterThan(0);
    expect(failed[0]!.error).toContain('Invalid values');
    await settle();
    expect(sheets.find('Sales', saleId)).toBeTruthy();
    expect((await getStatus()).failed).toBe(0);
  });

  it('sends data that existed before synchronisation was set up', async () => {
    const product = await makeProduct(world, { stock: 3 });
    await prisma.syncState.deleteMany(); // as if the database pre-dates the queue
    sheets.tabs_.get('Products')!.splice(1);
    await resendAll();
    await settle();
    expect(sheets.find('Products', product.id)).toBeTruthy();
    expect(sheets.find('Stock', `${product.id}:${world.branch.id}`)).toBeTruthy();
    expect(sheets.find('Users', world.users.CASHIER.id)).toBeTruthy();
  });

  it('never sends password hashes', () => {
    const header = sheets.tabs_.get('Users')![0] as string[];
    expect(header).not.toContain('passwordHash');
    expect(JSON.stringify(sheets.table('Users'))).not.toContain('$2');
  });

  it('applies a price edited in the sheet and keeps the price history', async () => {
    const product = await makeProduct(world, { price: 1000 });
    await settle();
    sheets.edit('Products', product.id, 'sellingPrice', 1500);
    await settle();
    const latest = await prisma.priceHistory.findFirstOrThrow({ where: { productId: product.id }, orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }] });
    expect(Number(latest.newPrice)).toBe(1500);
    expect(Number(latest.oldPrice)).toBe(1000);
    expect(await prisma.priceHistory.count({ where: { productId: product.id } })).toBe(2);
    expect(await prisma.auditLog.count({ where: { action: 'SHEETS_PULL', entityId: product.id } })).toBe(1);
    expect((await stateOf('Product', product.id)).status).toBe('SYNCED');
    expect(sheets.cell('Products', product.id, 'sellingPrice')).toBe(1500);
  });

  it('creates a product from a new sheet row and fills in its id', async () => {
    sheets.addRow('Products', { sku: 'NEW-1', name: 'Sheet Biscuits', unit: 'pcs', purchasePrice: 400, sellingPrice: 700, taxRate: 0, minStock: 3, isActive: true, barcode: '6001234567890' });
    await settle();
    const product = await prisma.product.findUniqueOrThrow({ where: { sku: 'NEW-1' }, include: { barcodes: true } });
    expect(product.name).toBe('Sheet Biscuits');
    expect(product.barcodes.map((b) => b.code)).toEqual(['6001234567890']);
    expect(sheets.cell('Products', product.id, 'sellingPrice')).toBe(700);
  });

  it('ignores invalid edits and logs them once', async () => {
    const product = await makeProduct(world, { price: 1000 });
    await settle();
    sheets.edit('Products', product.id, 'sellingPrice', 'abc');
    await settle();
    await settle();
    expect(await prisma.priceHistory.count({ where: { productId: product.id } })).toBe(1);
    expect(await prisma.syncLog.count({ where: { level: 'ERROR', message: { contains: 'Products row' } } })).toBe(1);
  });

  it('holds back a record changed in both places and applies the administrator\'s choice', async () => {
    const [a, b] = [await makeProduct(world, { name: 'A' }), await makeProduct(world, { name: 'B' })];
    await settle();
    for (const [product, mine] of [[a, 'A in POS'], [b, 'B in POS']] as const) {
      await prisma.product.update({ where: { id: product.id }, data: { name: mine } });
      sheets.edit('Products', product.id, 'name', `${product.name} in sheet`);
    }
    await settle();
    expect((await getStatus()).conflicts).toBe(2);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: a.id } })).name).toBe('A in POS');
    expect(sheets.cell('Products', a.id, 'name')).toBe('A in sheet');

    const logs = await prisma.syncLog.findMany({ where: { level: 'CONFLICT' } });
    await resolveConflict(logs.find((l) => l.recordId === a.id)!.id, 'LOCAL');
    await resolveConflict(logs.find((l) => l.recordId === b.id)!.id, 'SHEET');
    await settle();
    expect(sheets.cell('Products', a.id, 'name')).toBe('A in POS');
    expect((await prisma.product.findUniqueOrThrow({ where: { id: b.id } })).name).toBe('B in sheet');
    expect((await getStatus()).conflicts).toBe(0);
  });

  it('never deletes local data because the sheet is empty', async () => {
    const product = await makeProduct(world, { stock: 5 });
    const saleId = await sellOne(product.id);
    await settle();
    for (const rows of sheets.tabs_.values()) rows.splice(1);
    await settle();
    expect(await prisma.sale.count({ where: { id: saleId } })).toBe(1);
    expect(await prisma.product.count({ where: { id: product.id } })).toBe(1);
  });

  it('only lets administrators run or resolve synchronisation, but shows status to everyone', async () => {
    const cashierView = await request(app).get('/api/sync/status').set(auth(world.users.CASHIER.token));
    expect(cashierView.status).toBe(200);
    expect(cashierView.body).toMatchObject({ configured: true, spreadsheetUrl: null, lastError: null });
    expect((await request(app).get('/api/sync/status').set(auth(world.users.SUPER_ADMIN.token))).body.spreadsheetUrl).toContain('fake-spreadsheet');
    expect((await request(app).post('/api/sync/run').set(auth(world.users.CASHIER.token))).status).toBe(403);
    expect((await request(app).get('/api/sync/conflicts').set(auth(world.users.MANAGER.token))).status).toBe(403);
    expect((await request(app).post('/api/sync/run').set(auth(world.users.SUPER_ADMIN.token))).status).toBe(200);
  });
});

describe('conflict decision', () => {
  it.each([
    ['same on both sides', 'x', 'b', 'b', 'adopt'],
    ['only the POS changed', 'a', 'b', 'a', 'push'],
    ['only the sheet changed', 'a', 'a', 'b', 'pull'],
    ['both changed differently', 'a', 'b', 'c', 'conflict'],
    ['no agreed baseline and different', null, 'b', 'c', 'conflict'],
  ])('%s', (_name, base, local, sheet, expected) => {
    expect(decide(base, local, sheet)).toBe(expected);
  });
});
