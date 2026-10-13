import { Prisma } from '@prisma/client';
import { userNames } from '../lib/lookups';
import { prisma } from '../lib/prisma';
import { branchFor } from '../lib/scope';
import { COST_SQL, NET_REVENUE_SQL, PROFIT_SQL, TAX_SQL, branchSql, rawRows as rows } from '../lib/sql';
import { bucket, type Period } from '../lib/time';
import type { Actor } from '../types';
import { listBatches, listMovements, stockOverview } from './inventory.service';

export interface Column {
  key: string;
  label: string;
  type?: 'money' | 'number' | 'date' | 'text';
}

export interface ReportData {
  title: string;
  columns: Column[];
  rows: Record<string, unknown>[];
}

export interface ReportParams {
  from?: Date;
  to?: Date;
  branchId?: string;
  groupBy?: string;
  window?: string;
  reason?: string;
}

interface Ctx {
  actor: Actor;
  branchId?: string;
  from: Date;
  to: Date;
  params: ReportParams;
}

const ALL_ROWS = { page: 1, pageSize: 100_000 };
const text = (key: string, label: string): Column => ({ key, label, type: 'text' });
const money = (key: string, label: string): Column => ({ key, label, type: 'money' });
const num = (key: string, label: string): Column => ({ key, label, type: 'number' });

const completed = (c: Ctx) => Prisma.sql`s.status = 'COMPLETED' AND s."soldAt" >= ${c.from} AND s."soldAt" <= ${c.to} ${branchSql('s."branchId"', c.branchId)}`;

interface PeriodRow extends Record<string, unknown> {
  label: string;
  transactions: number;
  items: number;
  discounts: number;
  revenue: number;
}

const salesByPeriod = async (c: Ctx, unit: Period): Promise<ReportData> => {
  const sales = await prisma.sale.findMany({
    where: { status: 'COMPLETED', soldAt: { gte: c.from, lte: c.to }, branchId: c.branchId },
    select: { soldAt: true, discountTotal: true, total: true, items: { select: { quantity: true, returnedQty: true } } },
  });
  const groups = new Map<string, PeriodRow>();
  for (const sale of sales) {
    const label = bucket(sale.soldAt, unit);
    const g = groups.get(label) ?? { label, transactions: 0, items: 0, discounts: 0, revenue: 0 };
    g.transactions += 1;
    g.items += sale.items.reduce((n, i) => n + i.quantity.minus(i.returnedQty).toNumber(), 0);
    g.discounts += sale.discountTotal.toNumber();
    g.revenue += sale.total.toNumber();
    groups.set(label, g);
  }
  return {
    title: `Sales by ${unit}`,
    columns: [text('label', unit[0]!.toUpperCase() + unit.slice(1)), num('transactions', 'Transactions'), num('items', 'Items sold'), money('discounts', 'Discounts'), money('revenue', 'Revenue')],
    rows: [...groups.values()].sort((x, y) => x.label.localeCompare(y.label)),
  };
};

const salesBySale = async (c: Ctx, label: string, join: Prisma.Sql, key: Prisma.Sql): Promise<ReportData> => ({
  title: `Sales by ${label.toLowerCase()}`,
  columns: [text('label', label), num('transactions', 'Transactions'), money('discounts', 'Discounts'), money('revenue', 'Revenue')],
  rows: await rows(Prisma.sql`
    SELECT ${key} AS label, COUNT(*) AS transactions, SUM(s."discountTotal") AS discounts, SUM(s.total) AS revenue
    FROM "Sale" s ${join} WHERE ${completed(c)} GROUP BY 1 ORDER BY revenue DESC`),
});

const salesByItem = async (c: Ctx, label: string, key: Prisma.Sql, join: Prisma.Sql): Promise<ReportData> => ({
  title: `Sales by ${label.toLowerCase()}`,
  columns: [text('label', label), num('quantity', 'Quantity'), money('revenue', 'Revenue'), money('cost', 'Cost'), money('profit', 'Gross profit')],
  rows: await rows(Prisma.sql`
    SELECT ${key} AS label, SUM(si.quantity - si."returnedQty") AS quantity,
           SUM(${NET_REVENUE_SQL}) AS revenue, SUM(${COST_SQL}) AS cost, SUM(${PROFIT_SQL}) AS profit
    FROM "SaleItem" si JOIN "Sale" s ON s.id = si."saleId" ${join}
    WHERE ${completed(c)} GROUP BY 1 ORDER BY revenue DESC`),
});

const sales = (c: Ctx): Promise<ReportData> => {
  const groupBy = c.params.groupBy ?? 'day';
  switch (groupBy) {
    case 'week': case 'month': case 'day': return salesByPeriod(c, groupBy);
    case 'cashier': return salesBySale(c, 'Cashier', Prisma.sql`JOIN "User" u ON u.id = s."cashierId"`, Prisma.sql`u.name`);
    case 'branch': return salesBySale(c, 'Branch', Prisma.sql`JOIN "Branch" b ON b.id = s."branchId"`, Prisma.sql`b.name`);
    case 'product': return salesByItem(c, 'Product', Prisma.sql`p.name`, Prisma.sql`JOIN "Product" p ON p.id = si."productId"`);
    case 'category':
      return salesByItem(c, 'Category', Prisma.sql`COALESCE(cat.name, 'Uncategorised')`,
        Prisma.sql`JOIN "Product" p ON p.id = si."productId" LEFT JOIN "Category" cat ON cat.id = p."categoryId"`);
    case 'payment':
      return rows(Prisma.sql`
        SELECT pay.method AS label, COUNT(*) AS transactions, SUM(pay.amount) AS revenue
        FROM "Payment" pay JOIN "Sale" s ON s.id = pay."saleId" WHERE ${completed(c)} GROUP BY 1 ORDER BY revenue DESC`)
        .then((data) => ({ title: 'Sales by payment method', columns: [text('label', 'Method'), num('transactions', 'Payments'), money('revenue', 'Amount')], rows: data }));
    default: throw new Error(`Unknown grouping ${groupBy}`);
  }
};

const stockColumns = [text('sku', 'SKU'), text('name', 'Product'), text('category', 'Category'), num('quantity', 'In stock'), num('minStock', 'Min stock'), money('purchasePrice', 'Unit cost'), money('value', 'Value')];

const stockReport = (title: string, status: 'all' | 'low' | 'out') => async (c: Ctx): Promise<ReportData> => ({
  title,
  columns: stockColumns,
  rows: (await stockOverview(c.actor, { ...ALL_ROWS, branchId: c.branchId, status })).data,
});

const movements = async (c: Ctx): Promise<ReportData> => ({
  title: 'Stock movements',
  columns: [{ key: 'createdAt', label: 'Date', type: 'date' }, text('product', 'Product'), text('type', 'Type'), num('quantity', 'Quantity'), text('reference', 'Reference'), text('userName', 'User'), text('notes', 'Notes')],
  rows: (await listMovements(c.actor, { ...ALL_ROWS, branchId: c.branchId, from: c.from, to: c.to })).data
    .map((m) => ({ ...m, product: m.product.name })),
});

/** Written-off damaged stock, valued at cost price (never selling price). */
const damagedStock = async (c: Ctx): Promise<ReportData> => {
  const moves = await prisma.stockMovement.findMany({
    where: {
      type: 'DAMAGED', branchId: c.branchId, createdAt: { gte: c.from, lte: c.to },
      ...(c.params.reason && { notes: { contains: c.params.reason } }),
    },
    orderBy: { createdAt: 'desc' },
    include: { product: { select: { name: true, purchasePrice: true } }, branch: { select: { name: true } } },
  });
  const names = await userNames(moves.map((m) => m.userId));
  return {
    title: 'Damaged stock',
    columns: [{ key: 'createdAt', label: 'Date', type: 'date' }, text('product', 'Product'), num('quantity', 'Quantity damaged'), money('unitCost', 'Unit cost'), money('lossValue', 'Loss value'), text('branch', 'Branch'), text('reason', 'Reason'), text('userName', 'Recorded by')],
    rows: moves.map((m) => {
      const quantity = m.quantity.abs();
      // The cost recorded when the damage was booked; older records fall back to the product's current cost.
      const unitCost = m.unitCost ?? m.product.purchasePrice;
      return {
        id: m.id, createdAt: m.createdAt, product: m.product.name, quantity: quantity.toNumber(), unitCost: unitCost.toNumber(),
        lossValue: quantity.mul(unitCost).toDecimalPlaces(2).toNumber(), branch: m.branch.name, reason: m.notes ?? '', userName: names.get(m.userId) ?? '',
      };
    }),
  };
};

const expiring = async (c: Ctx): Promise<ReportData> => ({
  title: 'Expiring products',
  columns: [text('product', 'Product'), text('batchNo', 'Batch'), { key: 'expiryDate', label: 'Expiry', type: 'date' }, num('quantity', 'Quantity')],
  rows: (await listBatches(c.actor, { ...ALL_ROWS, branchId: c.branchId, window: (c.params.window ?? '30') as '30' })).data
    .map((b) => ({ ...b, product: b.product.name })),
});

const movingColumns = [text('sku', 'SKU'), text('name', 'Product'), num('sold', 'Qty sold'), num('stock', 'In stock')];

export const movingProducts = (branchId: string | undefined, from: Date, to: Date, order: 'fast' | 'slow', limit = 20) =>
  rows(Prisma.sql`
    SELECT p.sku, p.name, COALESCE(sold.q, 0) AS sold, COALESCE(st.q, 0) AS stock
    FROM "Product" p
    LEFT JOIN (SELECT si."productId", SUM(si.quantity - si."returnedQty") AS q FROM "SaleItem" si JOIN "Sale" s ON s.id = si."saleId"
               WHERE s.status = 'COMPLETED' AND s."soldAt" >= ${from} AND s."soldAt" <= ${to} ${branchSql('s."branchId"', branchId)} GROUP BY 1) sold ON sold."productId" = p.id
    LEFT JOIN (SELECT "productId", SUM(quantity) AS q FROM "StockLevel" WHERE true ${branchSql('"branchId"', branchId)} GROUP BY 1) st ON st."productId" = p.id
    WHERE p."isActive" ${order === 'slow' ? Prisma.sql`AND COALESCE(st.q, 0) > 0` : Prisma.sql`AND COALESCE(sold.q, 0) > 0`}
    ORDER BY ${order === 'fast' ? Prisma.sql`sold DESC` : Prisma.sql`sold ASC`}, p.name LIMIT ${limit}`);

const moving = (order: 'fast' | 'slow') => async (c: Ctx): Promise<ReportData> => ({
  title: order === 'fast' ? 'Fast-moving products' : 'Slow-moving products',
  columns: movingColumns,
  rows: await movingProducts(c.branchId, c.from, c.to, order, 50),
});

const financial = async (c: Ctx): Promise<ReportData> => {
  const [sale] = await rows(Prisma.sql`
    SELECT COALESCE(SUM(s.subtotal), 0) AS gross, COALESCE(SUM(s."discountTotal"), 0) AS discounts, COALESCE(SUM(s.total), 0) AS revenue
    FROM "Sale" s WHERE ${completed(c)}`);
  const [items] = await rows(Prisma.sql`
    SELECT COALESCE(SUM(${TAX_SQL}), 0) AS tax,
           COALESCE(SUM(${COST_SQL}), 0) AS cogs, COALESCE(SUM(${PROFIT_SQL}), 0) AS profit
    FROM "SaleItem" si JOIN "Sale" s ON s.id = si."saleId" WHERE ${completed(c)}`);
  const [refund] = await rows(Prisma.sql`
    SELECT COALESCE(SUM("refundAmount"), 0) AS amount FROM "Return"
    WHERE "createdAt" >= ${c.from} AND "createdAt" <= ${c.to} ${branchSql('"branchId"', c.branchId)}`);
  const [expense] = await rows(Prisma.sql`
    SELECT COALESCE(SUM(amount), 0) AS amount FROM "Expense"
    WHERE "incurredAt" >= ${c.from} AND "incurredAt" <= ${c.to} ${branchSql('"branchId"', c.branchId)}`);

  const n = (v: unknown) => Number(v ?? 0);
  const revenue = n(sale?.revenue);
  const refunds = n(refund?.amount);
  const profit = n(items?.profit);
  const expenses = n(expense?.amount);
  return {
    title: 'Financial summary',
    columns: [text('label', 'Item'), money('amount', 'Amount')],
    rows: [
      { label: 'Gross sales (before discounts)', amount: n(sale?.gross) },
      { label: 'Discounts', amount: -n(sale?.discounts) },
      { label: 'Revenue', amount: revenue },
      { label: 'Refunds', amount: -refunds },
      { label: 'Net revenue', amount: revenue - refunds },
      { label: 'Tax included in net revenue', amount: n(items?.tax) },
      { label: 'Cost of goods sold', amount: n(items?.cogs) },
      { label: 'Gross profit', amount: profit },
      { label: 'Expenses', amount: -expenses },
      { label: 'Net profit', amount: profit - expenses },
    ],
  };
};

const cashiers = async (c: Ctx): Promise<ReportData> => ({
  title: 'Cashier performance',
  columns: [text('cashier', 'Cashier'), num('sales', 'Sales'), money('revenue', 'Revenue'), money('discounts', 'Discounts'), money('refunds', 'Refunds'), num('voids', 'Voids'), num('sessions', 'Shifts'), money('variance', 'Cash variance')],
  rows: await rows(Prisma.sql`
    SELECT u.name AS cashier, COALESCE(sa.cnt, 0) AS sales, COALESCE(sa.rev, 0) AS revenue, COALESCE(sa.disc, 0) AS discounts,
           COALESCE(r.amt, 0) AS refunds, COALESCE(v.cnt, 0) AS voids, COALESCE(se.cnt, 0) AS sessions, COALESCE(se.diff, 0) AS variance
    FROM "User" u
    LEFT JOIN (SELECT s."cashierId", COUNT(*) AS cnt, SUM(s.total) AS rev, SUM(s."discountTotal") AS disc FROM "Sale" s WHERE ${completed(c)} GROUP BY 1) sa ON sa."cashierId" = u.id
    LEFT JOIN (SELECT s."cashierId", COUNT(*) AS cnt FROM "Sale" s WHERE s.status = 'VOIDED' AND s."soldAt" >= ${c.from} AND s."soldAt" <= ${c.to} ${branchSql('s."branchId"', c.branchId)} GROUP BY 1) v ON v."cashierId" = u.id
    LEFT JOIN (SELECT "cashierId", COUNT(*) AS cnt, SUM(difference) AS diff FROM "CashierSession" WHERE status = 'CLOSED' AND "openedAt" >= ${c.from} AND "openedAt" <= ${c.to} ${branchSql('"branchId"', c.branchId)} GROUP BY 1) se ON se."cashierId" = u.id
    LEFT JOIN (SELECT "userId", SUM("refundAmount") AS amt FROM "Return" WHERE "createdAt" >= ${c.from} AND "createdAt" <= ${c.to} ${branchSql('"branchId"', c.branchId)} GROUP BY 1) r ON r."userId" = u.id
    WHERE sa.cnt IS NOT NULL OR se.cnt IS NOT NULL OR r.amt IS NOT NULL OR v.cnt IS NOT NULL
    ORDER BY revenue DESC`),
});

const products = async (): Promise<ReportData> => {
  const list = await prisma.product.findMany({
    orderBy: { name: 'asc' },
    include: { category: true, barcodes: { orderBy: { isPrimary: 'desc' }, take: 1 }, prices: { orderBy: { effectiveFrom: 'desc' }, take: 1 } },
  });
  return {
    title: 'Products',
    columns: [text('sku', 'SKU'), text('barcode', 'Barcode'), text('name', 'Product'), text('category', 'Category'), text('unit', 'Unit'), money('purchasePrice', 'Cost price'), money('sellingPrice', 'Selling price'), num('taxRate', 'Tax %'), num('minStock', 'Min stock'), text('active', 'Active')],
    rows: list.map((p) => ({
      sku: p.sku, barcode: p.barcodes[0]?.code ?? '', name: p.name, category: p.category?.name ?? '', unit: p.unit,
      purchasePrice: p.purchasePrice.toNumber(), sellingPrice: p.prices[0]?.newPrice.toNumber() ?? 0, taxRate: p.taxRate.toNumber(),
      minStock: p.minStock.toNumber(), active: p.isActive ? 'Yes' : 'No',
    })),
  };
};

const purchases = async (c: Ctx): Promise<ReportData> => {
  const list = await prisma.purchase.findMany({
    where: { branchId: c.branchId, createdAt: { gte: c.from, lte: c.to } },
    orderBy: { createdAt: 'desc' },
    include: { supplier: true, _count: { select: { items: true } } },
  });
  return {
    title: 'Purchases',
    columns: [{ key: 'createdAt', label: 'Date', type: 'date' }, text('number', 'Purchase no.'), text('supplier', 'Supplier'), text('status', 'Status'), num('items', 'Lines'), money('total', 'Total')],
    rows: list.map((p) => ({ createdAt: p.createdAt, number: p.number, supplier: p.supplier.name, status: p.status, items: p._count.items, total: p.total.toNumber() })),
  };
};

const expenses = async (c: Ctx): Promise<ReportData> => ({
  title: 'Expenses',
  columns: [{ key: 'incurredAt', label: 'Date', type: 'date' }, text('category', 'Category'), text('description', 'Description'), money('amount', 'Amount')],
  rows: await rows(Prisma.sql`
    SELECT "incurredAt", category, description, amount AS amount FROM "Expense"
    WHERE "incurredAt" >= ${c.from} AND "incurredAt" <= ${c.to} ${branchSql('"branchId"', c.branchId)} ORDER BY "incurredAt" DESC`),
});

export const REPORTS = {
  sales,
  'inventory-current': stockReport('Current stock', 'all'),
  'stock-valuation': stockReport('Stock valuation', 'all'),
  'low-stock': stockReport('Low stock', 'low'),
  'out-of-stock': stockReport('Out of stock', 'out'),
  'stock-movements': movements,
  'damaged-stock': damagedStock,
  expiring,
  'fast-moving': moving('fast'),
  'slow-moving': moving('slow'),
  financial,
  cashier: cashiers,
  expenses,
  products,
  purchases,
} satisfies Record<string, (c: Ctx) => Promise<ReportData>>;

export type ReportName = keyof typeof REPORTS;
export const REPORT_NAMES = Object.keys(REPORTS) as [ReportName, ...ReportName[]];

const DAY_MS = 86_400_000;

export const runReport = (actor: Actor, name: ReportName, params: ReportParams) => {
  const to = params.to ?? new Date();
  const from = params.from ?? new Date(to.getTime() - 30 * DAY_MS);
  return REPORTS[name]({ actor, branchId: branchFor(actor, params.branchId), from, to, params });
};
