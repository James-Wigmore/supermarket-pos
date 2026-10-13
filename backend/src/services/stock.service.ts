import type { MovementType } from '@prisma/client';
import { conflict } from '../lib/errors';
import { d, qty, type Decimal, type Num } from '../lib/money';
import type { Tx } from '../lib/prisma';
import { businessToday } from '../lib/time';

export interface StockParams {
  productId: string;
  branchId: string;
  userId: string;
  type: MovementType;
  quantity: Num;
  unitCost?: Num;
  reference?: string;
  referenceId?: string;
  notes?: string;
}

export interface BatchInfo {
  batchNo: string;
  expiryDate?: Date | null;
}

export interface Slice {
  batchId: string | null;
  batchNo?: string;
  expiryDate?: Date | null;
  quantity: Decimal;
}

const changeLevel = async (tx: Tx, p: StockParams, delta: Decimal, allowNegative: boolean) => {
  const { productId, branchId } = p;
  if (delta.isNegative() && !allowNegative) {
    const { count } = await tx.stockLevel.updateMany({
      where: { productId, branchId, quantity: { gte: delta.abs() } },
      data: { quantity: { increment: delta } },
    });
    if (count === 0) {
      const product = await tx.product.findUnique({ where: { id: productId }, select: { name: true } });
      throw conflict(`Insufficient stock for ${product?.name ?? 'product'}`);
    }
    return;
  }
  await tx.stockLevel.upsert({
    where: { productId_branchId: { productId, branchId } },
    create: { productId, branchId, quantity: delta },
    update: { quantity: { increment: delta } },
  });
};

const record = (tx: Tx, p: StockParams, signed: Decimal, batchId: string | null) =>
  tx.stockMovement.create({
    data: {
      productId: p.productId,
      branchId: p.branchId,
      batchId,
      type: p.type,
      quantity: signed,
      unitCost: p.unitCost === undefined ? undefined : d(p.unitCost),
      userId: p.userId,
      reference: p.reference,
      referenceId: p.referenceId,
      notes: p.notes,
    },
  });

/** Adds stock (purchase, return, opening, transfer in...). Optionally into a batch. */
export const addStock = async (tx: Tx, p: StockParams & { batchId?: string | null; batch?: BatchInfo }) => {
  const amount = qty(p.quantity);
  await changeLevel(tx, p, amount, true);

  let batchId = p.batchId ?? null;
  if (p.batch) {
    const { productId, branchId } = p;
    const batch = await tx.productBatch.upsert({
      where: { productId_branchId_batchNo: { productId, branchId, batchNo: p.batch.batchNo } },
      create: { productId, branchId, batchNo: p.batch.batchNo, expiryDate: p.batch.expiryDate, quantity: amount },
      update: { quantity: { increment: amount } },
    });
    batchId = batch.id;
  } else if (batchId) {
    await tx.productBatch.update({ where: { id: batchId }, data: { quantity: { increment: amount } } });
  }
  await record(tx, p, amount, batchId);
};

const NO_EXPIRY = Number.MAX_SAFE_INTEGER;

/** First-expired-first-out allocation over unexpired batches. */
const allocateFefo = async (tx: Tx, p: StockParams, amount: Decimal, allowNegative: boolean) => {
  const found = await tx.productBatch.findMany({
    where: {
      productId: p.productId, branchId: p.branchId, quantity: { gt: 0 },
      OR: [{ expiryDate: null }, { expiryDate: { gte: businessToday() } }],
    },
    orderBy: { createdAt: 'asc' },
  });
  const batches = found.sort((a, b) => (a.expiryDate?.getTime() ?? NO_EXPIRY) - (b.expiryDate?.getTime() ?? NO_EXPIRY));

  const slices: Slice[] = [];
  let remaining = amount;
  for (const batch of batches) {
    if (remaining.lte(0)) break;
    const take = d(batch.quantity).lt(remaining) ? d(batch.quantity) : remaining;
    await tx.productBatch.update({ where: { id: batch.id }, data: { quantity: { decrement: take } } });
    slices.push({ batchId: batch.id, batchNo: batch.batchNo, expiryDate: batch.expiryDate, quantity: take });
    remaining = remaining.minus(take);
  }
  if (remaining.gt(0)) {
    if (!allowNegative) {
      const product = await tx.product.findUnique({ where: { id: p.productId }, select: { name: true } });
      throw conflict(`Insufficient non-expired stock for ${product?.name ?? 'product'}`);
    }
    slices.push({ batchId: null, quantity: remaining });
  }
  return slices;
};

interface RemoveOptions {
  allowNegative?: boolean;
  /** Take from this exact batch (write-offs). */
  batchId?: string;
  /** Allocate across batches by earliest expiry. */
  fefo?: boolean;
}

/** Removes stock (sale, damage, loss, transfer out...). Returns the batch slices that were consumed. */
export const removeStock = async (tx: Tx, p: StockParams, options: RemoveOptions = {}): Promise<Slice[]> => {
  const amount = qty(p.quantity);
  const allowNegative = options.allowNegative ?? false;
  await changeLevel(tx, p, amount.neg(), allowNegative);

  let slices: Slice[];
  if (options.batchId) {
    const { count } = await tx.productBatch.updateMany({
      where: { id: options.batchId, productId: p.productId, branchId: p.branchId, quantity: { gte: amount } },
      data: { quantity: { decrement: amount } },
    });
    if (count === 0) throw conflict('Insufficient stock in the selected batch');
    slices = [{ batchId: options.batchId, quantity: amount }];
  } else if (options.fefo) {
    slices = await allocateFefo(tx, p, amount, allowNegative);
  } else {
    slices = [{ batchId: null, quantity: amount }];
  }
  for (const slice of slices) await record(tx, p, slice.quantity.neg(), slice.batchId);
  return slices;
};
