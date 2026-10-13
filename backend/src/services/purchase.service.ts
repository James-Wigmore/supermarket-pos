import { Prisma } from '@prisma/client';
import { audit } from '../lib/audit';
import { badRequest, conflict, notFound } from '../lib/errors';
import { d, money, sum } from '../lib/money';
import { pageArgs, pageResult } from '../lib/pagination';
import { prisma, transact, type Tx } from '../lib/prisma';
import { branchFor, requireBranch } from '../lib/scope';
import { nextNumber } from '../lib/sequence';
import type { Actor } from '../types';
import type { CreatePurchaseInput, PurchaseListQuery, ReceiveLineInput } from '../validators/purchase';
import { addStock } from './stock.service';

const purchaseInclude = {
  supplier: { select: { id: true, name: true } },
  items: { include: { product: { select: { name: true, sku: true, unit: true, tracksExpiry: true } } } },
} satisfies Prisma.PurchaseInclude;

const createRecord = async (tx: Tx, actor: Actor, input: CreatePurchaseInput) => {
  const branchId = requireBranch(actor, input.branchId);
  const supplier = await tx.supplier.findFirst({ where: { id: input.supplierId, isActive: true } });
  const products = await tx.product.findMany({ where: { id: { in: input.items.map((i) => i.productId) }, isActive: true }, select: { id: true } });
  if (!supplier) throw notFound('Supplier');
  if (products.length !== new Set(input.items.map((i) => i.productId)).size) throw badRequest('One or more products are missing or inactive');

  const purchase = await tx.purchase.create({
    data: {
      number: await nextNumber(tx, 'PO'),
      clientRef: input.clientRef,
      supplierId: supplier.id,
      branchId,
      status: 'ORDERED',
      notes: input.notes,
      createdById: actor.id,
      total: sum(input.items.map((i) => money(i.unitCost).mul(i.quantity))),
    },
  });
  const items = [];
  for (const line of input.items) {
    items.push(await tx.purchaseItem.create({
      data: { purchaseId: purchase.id, productId: line.productId, quantityOrdered: line.quantity, unitCost: money(line.unitCost), batchNo: line.batchNo, expiryDate: line.expiryDate },
    }));
  }
  await audit(tx, actor, { action: 'PURCHASE_ORDER_CREATE', entity: 'Purchase', entityId: purchase.id, branchId, after: { number: purchase.number, total: purchase.total } });
  return { purchase, items };
};

/** Books received goods into stock: movements, last purchase price, supplier price memory and balance. */
const receiveLines = async (tx: Tx, actor: Actor, purchaseId: string, lines: ReceiveLineInput[]) => {
  const purchase = await tx.purchase.findUnique({ where: { id: purchaseId }, include: { items: { include: { product: true } } } });
  if (!purchase) throw notFound('Purchase');
  branchFor(actor, purchase.branchId);
  if (purchase.status !== 'ORDERED') throw conflict(`Purchase is already ${purchase.status.toLowerCase()}`);

  const byId = new Map(purchase.items.map((item) => [item.id, item]));
  let received = d(0);
  for (const line of lines) {
    const item = byId.get(line.itemId);
    if (!item) throw badRequest('Item does not belong to this purchase');
    const outstanding = d(item.quantityOrdered).minus(item.quantityReceived);
    if (d(line.quantity).gt(outstanding)) throw badRequest(`Cannot receive more than ordered for ${item.product.name}`);
    if (item.product.tracksExpiry && !line.expiryDate) throw badRequest(`Expiry date is required for ${item.product.name}`);

    const unitCost = money(line.unitCost ?? item.unitCost);
    const batch = line.batchNo || line.expiryDate
      ? { batchNo: line.batchNo ?? line.expiryDate!.toISOString().slice(0, 10), expiryDate: line.expiryDate }
      : undefined;
    await addStock(tx, {
      productId: item.productId, branchId: purchase.branchId, userId: actor.id, type: 'PURCHASE',
      quantity: line.quantity, unitCost, reference: purchase.number, referenceId: purchase.id, batch,
    });
    await tx.purchaseItem.update({
      where: { id: item.id },
      data: { quantityReceived: { increment: line.quantity }, unitCost, batchNo: batch?.batchNo ?? item.batchNo, expiryDate: line.expiryDate ?? item.expiryDate },
    });
    await tx.product.update({ where: { id: item.productId }, data: { purchasePrice: unitCost } });
    await tx.supplierPrice.upsert({
      where: { supplierId_productId: { supplierId: purchase.supplierId, productId: item.productId } },
      create: { supplierId: purchase.supplierId, productId: item.productId, unitCost },
      update: { unitCost },
    });
    received = received.plus(unitCost.mul(line.quantity));
    item.quantityReceived = d(item.quantityReceived).plus(line.quantity);
  }

  const complete = purchase.items.every((item) => d(item.quantityReceived).gte(item.quantityOrdered));
  await tx.supplier.update({ where: { id: purchase.supplierId }, data: { balance: { increment: received } } });
  const updated = await tx.purchase.update({
    where: { id: purchase.id },
    data: complete ? { status: 'RECEIVED', receivedAt: new Date() } : {},
    include: purchaseInclude,
  });
  await audit(tx, actor, {
    action: 'STOCK_RECEIVE', entity: 'Purchase', entityId: purchase.id, branchId: purchase.branchId,
    after: { number: purchase.number, value: received, lines: lines.length, complete },
  });
  return updated;
};

export const createPurchase = (actor: Actor, input: CreatePurchaseInput) =>
  transact(async (tx) => (await createRecord(tx, actor, input)).purchase);

export const receivePurchase = (actor: Actor, id: string, lines: ReceiveLineInput[]) =>
  transact((tx) => receiveLines(tx, actor, id, lines));

/** Receiving mode: a whole delivery is booked in one transaction, without a prior order. */
/** Receiving mode books a whole delivery at once; repeating the same clientRef returns the original instead of receiving twice. */
export const receiveDelivery = async (actor: Actor, input: CreatePurchaseInput) => {
  const find = () => (input.clientRef ? prisma.purchase.findUnique({ where: { clientRef: input.clientRef }, include: purchaseInclude }) : null);
  const existing = await find();
  if (existing) return { ...existing, duplicate: true };
  try {
    return { ...(await receiveDeliveryTx(actor, input)), duplicate: false };
  } catch (err) {
    const raced = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' ? await find() : null;
    if (raced) return { ...raced, duplicate: true };
    throw err;
  }
};

const receiveDeliveryTx = (actor: Actor, input: CreatePurchaseInput) =>
  transact(async (tx) => {
    const { purchase, items } = await createRecord(tx, actor, input);
    const lines = items.map((item, index) => ({
      itemId: item.id, quantity: Number(item.quantityOrdered), batchNo: input.items[index]?.batchNo, expiryDate: input.items[index]?.expiryDate,
    }));
    return receiveLines(tx, actor, purchase.id, lines);
  });

export const cancelPurchase = (actor: Actor, id: string) =>
  transact(async (tx) => {
    const purchase = await tx.purchase.findUnique({ where: { id }, include: { items: true } });
    if (!purchase) throw notFound('Purchase');
    branchFor(actor, purchase.branchId);
    if (purchase.status !== 'ORDERED' || purchase.items.some((i) => d(i.quantityReceived).gt(0))) {
      throw conflict('Only orders with nothing received can be cancelled');
    }
    await audit(tx, actor, { action: 'PURCHASE_CANCEL', entity: 'Purchase', entityId: id, branchId: purchase.branchId });
    return tx.purchase.update({ where: { id }, data: { status: 'CANCELLED' } });
  });

export const listPurchases = async (actor: Actor, q: PurchaseListQuery) => {
  const where: Prisma.PurchaseWhereInput = {
    branchId: branchFor(actor, q.branchId), supplierId: q.supplierId, status: q.status, createdAt: { gte: q.from, lte: q.to },
  };
  const [rows, total] = await Promise.all([
    prisma.purchase.findMany({ where, include: { supplier: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' }, ...pageArgs(q) }),
    prisma.purchase.count({ where }),
  ]);
  return pageResult(rows, total, q);
};

export const getPurchase = async (actor: Actor, id: string) => {
  const purchase = await prisma.purchase.findUnique({ where: { id }, include: purchaseInclude });
  if (!purchase) throw notFound('Purchase');
  branchFor(actor, purchase.branchId);
  return purchase;
};

export const paySupplier = (actor: Actor, supplierId: string, amount: number, note?: string) =>
  transact(async (tx) => {
    const supplier = await tx.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier) throw notFound('Supplier');
    const payment = await tx.supplierPayment.create({ data: { supplierId, userId: actor.id, amount: money(amount), note } });
    await tx.supplier.update({ where: { id: supplierId }, data: { balance: { decrement: payment.amount } } });
    await audit(tx, actor, { action: 'SUPPLIER_PAYMENT', entity: 'Supplier', entityId: supplierId, after: { amount: payment.amount, note } });
    return payment;
  });

export const supplierHistory = async (supplierId: string) => {
  const [supplier, purchases, payments] = await Promise.all([
    prisma.supplier.findUnique({ where: { id: supplierId } }),
    prisma.purchase.findMany({ where: { supplierId }, orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.supplierPayment.findMany({ where: { supplierId }, orderBy: { createdAt: 'desc' }, take: 100 }),
  ]);
  if (!supplier) throw notFound('Supplier');
  return { supplier, purchases, payments };
};
