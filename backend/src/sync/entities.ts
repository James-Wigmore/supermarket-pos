import { z } from 'zod';
import { prisma, type Tx } from '../lib/prisma';
import { currentPrices } from '../services/pricing.service';
import { toCell, type Cell, type Row } from './cells';

/** Edits made in Google Sheets to these columns are applied to the POS; everything else is one-way (POS to sheet). */
export interface PullSpec {
  editable: string[];
  /** Validates the raw cells of a sheet row. Throws a readable error when the row is not acceptable. */
  parse(raw: Row, creating: boolean): Row;
  update(tx: Tx, id: string, values: Row): Promise<void>;
  /** Present when owners may add rows (blank id) in the sheet. Returns the new record's id. */
  create?(tx: Tx, values: Row): Promise<string>;
}

export interface EntitySpec {
  entity: string;
  tab: string;
  /** Sheet header row. The first column identifies the record. */
  columns: string[];
  /** Loads records by id as flat rows keyed by column name. */
  fetch(ids: string[]): Promise<Row[]>;
  pull?: PullSpec;
}

interface Delegate {
  findMany(args: { where: unknown; include?: unknown }): Promise<Row[]>;
}

const byKey = (model: () => unknown, key = 'id') => (ids: string[]) =>
  (model() as Delegate).findMany({ where: { [key]: { in: ids } } });

const named = (model: () => unknown, relation: string, fields: Record<string, string>) => async (ids: string[]) => {
  const rows = await (model() as Delegate).findMany({ where: { id: { in: ids } }, include: { [relation]: true } });
  return rows.map((row) => ({ ...row, ...Object.fromEntries(Object.entries(fields).map(([column, field]) => [column, (row[relation] as Row)[field]])) }));
};

// ---------- values typed from raw sheet cells ----------
const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => text(max).transform((s) => s || null);
const amount = z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number().finite().min(0));
const optionalAmount = z.preprocess((v) => (v === '' ? null : v), z.coerce.number().finite().min(0).nullable());
const flag = z.preprocess((v) => (typeof v === 'string' ? ['true', 'yes', 'y', '1'].includes(v.trim().toLowerCase()) : v), z.boolean());
const optionalDate = z.preprocess((v) => (v === '' ? null : v), z.coerce.date().nullable());

const schemaParser = (update: z.ZodObject, create?: z.ZodObject) => (raw: Row, creating: boolean) =>
  (creating && create ? create : update).parse(raw) as Row;

// ---------- products ----------
const categoryIdByName = async (tx: Tx, name: string) => {
  if (!name) return null;
  const match = (await tx.category.findMany()).find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (!match) throw new Error(`Unknown category "${name}". Add it on the Categories sheet first.`);
  return match.id;
};

const productFields = {
  name: text(200).min(1), brand: optionalText(100), category: text(100), unit: text(20).transform((s) => s || 'pcs'),
  purchasePrice: amount, sellingPrice: amount, taxRate: amount.pipe(z.number().max(100)), minStock: amount, maxStock: optionalAmount, isActive: flag,
};
const productUpdate = z.object(productFields);
const productCreate = z.object({ ...productFields, sku: text(50).min(1), barcode: text(64) });

const setSellingPrice = async (tx: Tx, productId: string, price: number, isNew: boolean) => {
  const current = isNew ? undefined : (await currentPrices(tx, [productId])).get(productId);
  if (current?.equals(price)) return;
  await tx.priceHistory.create({
    data: { productId, oldPrice: current ?? null, newPrice: price, effectiveFrom: new Date(), userId: 'google-sheets', reason: 'Changed in Google Sheets' },
  });
};

const productRows = async (ids: string[]) => {
  const [products, prices] = await Promise.all([
    prisma.product.findMany({ where: { id: { in: ids } }, include: { category: true, barcodes: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }], take: 1 } } }),
    currentPrices(prisma, ids),
  ]);
  return products.map((p) => ({ ...p, category: p.category?.name ?? '', barcode: p.barcodes[0]?.code ?? '', sellingPrice: prices.get(p.id) ?? '' }));
};

const PRODUCT: PullSpec = {
  editable: ['category', 'name', 'brand', 'unit', 'purchasePrice', 'sellingPrice', 'taxRate', 'minStock', 'maxStock', 'isActive'],
  parse: schemaParser(productUpdate, productCreate),
  update: async (tx, id, { sellingPrice, category, ...fields }) => {
    await tx.product.update({ where: { id }, data: { ...(fields as object), categoryId: await categoryIdByName(tx, category as string) } });
    await setSellingPrice(tx, id, sellingPrice as number, false);
  },
  create: async (tx, { sellingPrice, category, barcode, ...fields }) => {
    const product = await tx.product.create({ data: { ...(fields as { sku: string; name: string }), categoryId: await categoryIdByName(tx, category as string) } });
    await setSellingPrice(tx, product.id, sellingPrice as number, true);
    if (barcode) await tx.barcode.create({ data: { code: barcode as string, productId: product.id, isPrimary: true } });
    return product.id;
  },
};

// ---------- other master data ----------
const CATEGORY: PullSpec = {
  editable: ['name'],
  parse: schemaParser(z.object({ name: text(100).min(1) })),
  update: async (tx, id, values) => void (await tx.category.update({ where: { id }, data: values as { name: string } })),
  create: async (tx, values) => (await tx.category.create({ data: values as { name: string } })).id,
};

const supplierSchema = z.object({
  name: text(150).min(1), contact: optionalText(100), phone: optionalText(30), email: optionalText(150), address: optionalText(250), isActive: flag,
});
const SUPPLIER: PullSpec = {
  editable: ['name', 'contact', 'phone', 'email', 'address', 'isActive'],
  parse: schemaParser(supplierSchema),
  update: async (tx, id, values) => void (await tx.supplier.update({ where: { id }, data: values as { name: string } })),
  create: async (tx, values) => (await tx.supplier.create({ data: values as { name: string } })).id,
};

const PROMOTION: PullSpec = {
  editable: ['name', 'value', 'startsAt', 'endsAt', 'isActive'],
  parse: schemaParser(z.object({ name: text(150).min(1), value: amount, startsAt: z.coerce.date(), endsAt: optionalDate, isActive: flag })),
  update: async (tx, id, values) => void (await tx.promotion.update({ where: { id }, data: values as { name: string } })),
};

const same = (entity: string, tab: string, columns: string[], model: () => unknown): EntitySpec => ({ entity, tab, columns, fetch: byKey(model) });

/** Every synchronised table, in the order its sheet is written. */
export const ENTITIES: EntitySpec[] = [
  { entity: 'Product', tab: 'Products', fetch: productRows, pull: PRODUCT,
    columns: ['id', 'sku', 'barcode', 'name', 'brand', 'category', 'categoryId', 'supplierId', 'unit', 'purchasePrice', 'sellingPrice', 'taxRate', 'minStock', 'maxStock', 'tracksExpiry', 'isActive', 'createdAt', 'updatedAt'] },
  { ...same('Category', 'Categories', ['id', 'name', 'createdAt'], () => prisma.category), pull: CATEGORY },
  { entity: 'StockLevel', tab: 'Stock', columns: ['id', 'sku', 'productName', 'productId', 'branchId', 'quantity'],
    fetch: async (ids) => {
      const rows = await prisma.stockLevel.findMany({ where: { OR: ids.map((id) => ({ productId: id.split(':')[0], branchId: id.split(':')[1] })) }, include: { product: true } });
      return rows.map((r) => ({ ...r, id: `${r.productId}:${r.branchId}`, sku: r.product.sku, productName: r.product.name }));
    } },
  { entity: 'StockMovement', tab: 'Stock_Movements', columns: ['id', 'createdAt', 'productName', 'productId', 'branchId', 'batchId', 'type', 'quantity', 'unitCost', 'userId', 'reference', 'referenceId', 'notes'],
    fetch: named(() => prisma.stockMovement, 'product', { productName: 'name' }) },
  same('Sale', 'Sales', ['id', 'receiptNo', 'branchId', 'sessionId', 'cashierId', 'customerId', 'status', 'subtotal', 'discountTotal', 'taxTotal', 'total', 'changeGiven', 'offline', 'soldAt', 'voidedAt', 'voidedById', 'voidReason', 'createdAt'], () => prisma.sale),
  same('SaleItem', 'Sale_Items', ['id', 'saleId', 'productId', 'name', 'quantity', 'returnedQty', 'unitPrice', 'unitCost', 'discount', 'taxRate', 'taxAmount', 'lineTotal'], () => prisma.saleItem),
  same('Payment', 'Payments', ['id', 'saleId', 'method', 'amount', 'reference'], () => prisma.payment),
  { entity: 'Purchase', tab: 'Purchases', columns: ['id', 'number', 'supplierName', 'supplierId', 'branchId', 'status', 'total', 'notes', 'createdById', 'createdAt', 'receivedAt'],
    fetch: named(() => prisma.purchase, 'supplier', { supplierName: 'name' }) },
  { entity: 'PurchaseItem', tab: 'Purchase_Items', columns: ['id', 'purchaseId', 'productName', 'productId', 'quantityOrdered', 'quantityReceived', 'unitCost', 'batchNo', 'expiryDate'],
    fetch: named(() => prisma.purchaseItem, 'product', { productName: 'name' }) },
  { ...same('Supplier', 'Suppliers', ['id', 'name', 'contact', 'phone', 'email', 'address', 'balance', 'isActive', 'createdAt', 'updatedAt'], () => prisma.supplier), pull: SUPPLIER },
  same('Customer', 'Customers', ['id', 'name', 'phone', 'email', 'loyaltyPoints', 'createdAt', 'updatedAt'], () => prisma.customer),
  same('Return', 'Returns', ['id', 'number', 'saleId', 'branchId', 'sessionId', 'userId', 'approvedById', 'method', 'refundAmount', 'reason', 'createdAt'], () => prisma.return),
  same('ReturnItem', 'Return_Items', ['id', 'returnId', 'saleItemId', 'quantity', 'amount', 'restock'], () => prisma.returnItem),
  { ...same('Promotion', 'Promotions', ['id', 'name', 'type', 'value', 'minQty', 'buyQty', 'getQty', 'productId', 'startsAt', 'endsAt', 'isActive', 'createdAt'], () => prisma.promotion), pull: PROMOTION },
  // Password hashes and token versions never leave the computer.
  same('User', 'Users', ['id', 'email', 'name', 'role', 'branchId', 'isActive', 'lastLoginAt', 'createdAt', 'updatedAt'], () => prisma.user),
  same('Branch', 'Branches', ['id', 'code', 'name', 'address', 'phone', 'isActive', 'createdAt', 'updatedAt'], () => prisma.branch),
  same('Register', 'Registers', ['id', 'branchId', 'name', 'isActive', 'createdAt'], () => prisma.register),
  same('CashierSession', 'Shifts', ['id', 'registerId', 'branchId', 'cashierId', 'status', 'openingCash', 'expectedCash', 'actualCash', 'difference', 'notes', 'openedAt', 'closedAt'], () => prisma.cashierSession),
  same('Expense', 'Expenses', ['id', 'branchId', 'userId', 'category', 'amount', 'description', 'incurredAt', 'createdAt'], () => prisma.expense),
  { entity: 'Setting', tab: 'Settings', columns: ['key', 'value', 'updatedAt'], fetch: byKey(() => prisma.setting, 'key') },
  same('AuditLog', 'Audit_Log', ['id', 'createdAt', 'userId', 'branchId', 'action', 'entity', 'entityId', 'before', 'after', 'ip'], () => prisma.auditLog),
];

/** The sync journal is written by the engine itself, not by triggers. */
export const LOG_TAB = { tab: 'Sync_Log', columns: ['id', 'createdAt', 'level', 'entity', 'recordId', 'message', 'resolution'] };

export const rowCells = (columns: string[], row: Row): Cell[] => columns.map((column) => toCell(row[column]));
