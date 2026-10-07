import { Prisma, type MovementType } from '@prisma/client';
import { audit } from '../lib/audit';
import { badRequest, notFound } from '../lib/errors';
import { userNames } from '../lib/lookups';
import { pageArgs, pageResult } from '../lib/pagination';
import { prisma, transact } from '../lib/prisma';
import { branchFor, requireBranch } from '../lib/scope';
import { nextNumber } from '../lib/sequence';
import { rawRows } from '../lib/sql';
import { utcToday } from '../lib/time';
import type { Actor } from '../types';
import type { AdjustStockInput, BatchQuery, MovementQuery, StockOverviewQuery, TransferStockInput } from '../validators/stock';
import { addStock, removeStock } from './stock.service';

const DIRECTION: Record<AdjustStockInput['type'], 'IN' | 'OUT' | undefined> = {
  OPENING: 'IN', DAMAGED: 'OUT', EXPIRED: 'OUT', LOSS: 'OUT', ADJUSTMENT: undefined,
};

export const adjustStock = (actor: Actor, input: AdjustStockInput) =>
  transact(async (tx) => {
    const branchId = requireBranch(actor, input.branchId);
    const product = await tx.product.findUnique({ where: { id: input.productId } });
    if (!product) throw notFound('Product');

    const direction = DIRECTION[input.type] ?? input.direction!;
    const params = { productId: product.id, branchId, userId: actor.id, type: input.type as MovementType, quantity: input.quantity, notes: input.notes, reference: 'ADJUSTMENT' };

    if (direction === 'IN') {
      if (product.tracksExpiry && !input.batchId && !input.expiryDate) throw badRequest('Expiry date is required for this product');
      const batch = input.expiryDate
        ? { batchNo: input.batchNo ?? input.expiryDate.toISOString().slice(0, 10), expiryDate: input.expiryDate }
        : undefined;
      await addStock(tx, { ...params, batch, batchId: input.batchId });
    } else {
      if (input.type === 'EXPIRED' && product.tracksExpiry && !input.batchId) throw badRequest('Select the expired batch to write off');
      await removeStock(tx, params, { batchId: input.batchId, fefo: product.tracksExpiry });
    }
    await audit(tx, actor, {
      action: 'STOCK_ADJUST', entity: 'Product', entityId: product.id, branchId,
      after: { type: input.type, direction, quantity: input.quantity, notes: input.notes, batchId: input.batchId },
    });
  });

export const transferStock = (actor: Actor, input: TransferStockInput) =>
  transact(async (tx) => {
    const fromBranchId = requireBranch(actor, input.fromBranchId);
    if (fromBranchId === input.toBranchId) throw badRequest('Source and destination branch must differ');
    const product = await tx.product.findUnique({ where: { id: input.productId } });
    const target = await tx.branch.findFirst({ where: { id: input.toBranchId, isActive: true } });
    if (!product) throw notFound('Product');
    if (!target) throw notFound('Destination branch');

    const reference = await nextNumber(tx, 'TRF');
    const base = { productId: product.id, userId: actor.id, reference, notes: input.notes };
    const slices = await removeStock(tx, { ...base, branchId: fromBranchId, type: 'TRANSFER_OUT', quantity: input.quantity }, { fefo: product.tracksExpiry });
    for (const slice of slices) {
      const batch = slice.batchNo ? { batchNo: slice.batchNo, expiryDate: slice.expiryDate } : undefined;
      await addStock(tx, { ...base, branchId: target.id, type: 'TRANSFER_IN', quantity: slice.quantity, batch });
    }
    await audit(tx, actor, {
      action: 'STOCK_TRANSFER', entity: 'Product', entityId: product.id, branchId: fromBranchId,
      after: { reference, from: fromBranchId, to: target.id, quantity: input.quantity },
    });
    return { reference };
  });

/** Current stock per product (branch, or all branches summed for super admins), with valuation. */
export const stockOverview = async (actor: Actor, q: StockOverviewQuery) => {
  const branchId = branchFor(actor, q.branchId);
  const levelFilter = branchId ? Prisma.sql`WHERE "branchId" = ${branchId}` : Prisma.empty;
  const category = q.categoryId ? Prisma.sql`AND p."categoryId" = ${q.categoryId}` : Prisma.empty;
  const status = {
    all: Prisma.empty,
    low: Prisma.sql`AND COALESCE(s.quantity, 0) > 0 AND COALESCE(s.quantity, 0) <= p."minStock"`,
    out: Prisma.sql`AND COALESCE(s.quantity, 0) <= 0`,
  }[q.status];
  const search = q.search ? Prisma.sql`AND (p.name LIKE ${`%${q.search}%`} OR p.sku LIKE ${`%${q.search}%`})` : Prisma.empty;
  const from = Prisma.sql`
    FROM "Product" p
    LEFT JOIN "Category" c ON c.id = p."categoryId"
    LEFT JOIN (SELECT "productId", SUM(quantity) AS quantity FROM "StockLevel" ${levelFilter} GROUP BY "productId") s ON s."productId" = p.id
    WHERE p."isActive" ${search} ${category} ${status}`;
  const { skip, take } = pageArgs(q);

  const [rows, count] = await Promise.all([
    rawRows(Prisma.sql`
      SELECT p.id, p.sku, p.name, p.unit, p."minStock", p."maxStock", p."purchasePrice", p."tracksExpiry",
             c.name AS category, COALESCE(s.quantity, 0) AS quantity, COALESCE(s.quantity, 0) * p."purchasePrice" AS value
      ${from} ORDER BY p.name LIMIT ${take} OFFSET ${skip}`),
    rawRows<{ n: number }>(Prisma.sql`SELECT COUNT(*) AS n ${from}`),
  ]);
  return pageResult(rows, count[0]?.n ?? 0, q);
};

export const listMovements = async (actor: Actor, q: MovementQuery) => {
  const where: Prisma.StockMovementWhereInput = {
    branchId: branchFor(actor, q.branchId),
    productId: q.productId,
    type: q.type,
    createdAt: { gte: q.from, lte: q.to },
  };
  const [rows, total] = await Promise.all([
    prisma.stockMovement.findMany({
      where, orderBy: { createdAt: 'desc' }, ...pageArgs(q),
      include: { product: { select: { name: true, sku: true, unit: true } }, batch: { select: { batchNo: true } } },
    }),
    prisma.stockMovement.count({ where }),
  ]);
  const names = await userNames(rows.map((r) => r.userId));
  return pageResult(rows.map((r) => ({ ...r, userName: names.get(r.userId) ?? null })), total, q);
};

const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);

const expiryFilter = (window: BatchQuery['window']): Prisma.DateTimeNullableFilter => {
  const today = utcToday();
  switch (window) {
    case 'expired': return { lt: today };
    case 'today': return { gte: today, lt: addDays(today, 1) };
    case 'all': return { not: null };
    default: return { gte: today, lt: addDays(today, Number(window) + 1) };
  }
};

export const listBatches = async (actor: Actor, q: BatchQuery) => {
  const where: Prisma.ProductBatchWhereInput = { branchId: branchFor(actor, q.branchId), quantity: { gt: 0 }, expiryDate: expiryFilter(q.window) };
  const [rows, total] = await Promise.all([
    prisma.productBatch.findMany({
      where, orderBy: { expiryDate: 'asc' }, ...pageArgs(q),
      include: { product: { select: { name: true, sku: true, unit: true } } },
    }),
    prisma.productBatch.count({ where }),
  ]);
  return pageResult(rows, total, q);
};
