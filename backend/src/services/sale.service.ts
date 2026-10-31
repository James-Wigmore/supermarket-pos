import { Prisma } from '@prisma/client';
import { audit } from '../lib/audit';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { userNames } from '../lib/lookups';
import { Decimal, ZERO } from '../lib/money';
import { pageArgs, pageResult } from '../lib/pagination';
import { settlePayments } from '../lib/payment';
import { can, P } from '../lib/permissions';
import { prisma, transact, type Tx } from '../lib/prisma';
import { branchFor } from '../lib/scope';
import { nextNumber } from '../lib/sequence';
import { getSettings } from '../lib/settings';
import type { Actor } from '../types';
import type { CartLine, CreateSaleInput, SaleListQuery } from '../validators/sale';
import { authorizeAction } from './approval.service';
import { priceCart, type PricedCart } from './cart.service';
import { sessionSummary } from './session.service';
import { addStock, removeStock } from './stock.service';

const MAX_HELD_SALES = 20;

const saleInclude = {
  items: { orderBy: { name: 'asc' } },
  payments: true,
  customer: { select: { id: true, name: true, phone: true } },
  returns: { select: { id: true, number: true, refundAmount: true, createdAt: true } },
} satisfies Prisma.SaleInclude;

/** Cart preview for the POS. Cost prices are never exposed to cashiers. */
export const quoteCart = async (items: CartLine[]) => {
  const cart = await priceCart(prisma, items, new Date());
  return { ...cart, lines: cart.lines.map(({ unitCost: _cost, tracksExpiry: _expiry, ...line }) => line) };
};

const authorizeCart = async (tx: Tx, actor: Actor, cart: PricedCart, input: CreateSaleInput, branchId: string) => {
  const settings = await getSettings(tx);
  const maxPercent = cart.lines.reduce((max, l) => Decimal.max(max, l.manualPercent), ZERO);
  const limit = settings.discountLimitPercent[actor.role];
  const hasDiscount = cart.lines.some((l) => l.manualDiscount.gt(ZERO));
  const overridden = cart.lines.some((l) => l.overridden);

  if (hasDiscount && !can(actor.role, P.DISCOUNT_APPLY)) throw forbidden('You cannot apply discounts');
  if (!overridden && maxPercent.lte(limit)) return;
  if (maxPercent.gt(limit) && can(actor.role, P.PRICE_OVERRIDE)) throw forbidden(`Discount exceeds your limit of ${limit}%`);

  await authorizeAction(
    tx, actor, P.PRICE_OVERRIDE, input.approval, branchId,
    { action: overridden ? 'PRICE_OVERRIDE' : 'DISCOUNT_OVER_LIMIT', entity: 'Sale', entityId: input.clientId },
    (role) => maxPercent.lte(settings.discountLimitPercent[role]),
  );
};

const loadSale = (db: Pick<typeof prisma, 'sale'>, where: Prisma.SaleWhereUniqueInput) =>
  db.sale.findUnique({ where, include: saleInclude });

const createSaleTx = (actor: Actor, input: CreateSaleInput) =>
  transact(async (tx) => {
    const session = await tx.cashierSession.findUnique({ where: { id: input.sessionId } });
    if (!session || session.cashierId !== actor.id) throw notFound('Session');
    branchFor(actor, session.branchId);

    const now = new Date();
    const claimed = input.offline && input.soldAt ? input.soldAt : now;
    const soldAt = claimed > now ? now : claimed;
    if (soldAt < session.openedAt) throw badRequest('The sale time is before the shift started');
    // A closed shift only accepts late uploads of sales that really happened while it was open.
    if (session.status !== 'OPEN' && !(input.offline && session.closedAt && soldAt <= session.closedAt)) {
      throw conflict('Your shift is closed, open a new shift to sell');
    }
    const cart = await priceCart(tx, input.items, soldAt);
    await authorizeCart(tx, actor, cart, input, session.branchId);
    const { change, recorded } = settlePayments(cart.total, input.payments);

    const settings = await getSettings(tx);
    const receiptNo = await nextNumber(tx, 'RCT');
    const sale = await tx.sale.create({
      data: {
        clientId: input.clientId, receiptNo, branchId: session.branchId, sessionId: session.id, cashierId: actor.id,
        customerId: input.customerId, subtotal: cart.subtotal, discountTotal: cart.discountTotal, taxTotal: cart.taxTotal,
        total: cart.total, changeGiven: change, offline: input.offline, soldAt,
        items: {
          create: cart.lines.map((l) => ({
            productId: l.productId, name: l.name, quantity: l.quantity, unitPrice: l.unitPrice, unitCost: l.unitCost,
            discount: l.discount, taxRate: l.taxRate, taxAmount: l.taxAmount, lineTotal: l.lineTotal,
          })),
        },
        payments: { create: recorded },
      },
    });

    // Stock is only touched here, inside the same transaction that records the sale.
    for (const line of cart.lines) {
      await removeStock(
        tx,
        { productId: line.productId, branchId: session.branchId, userId: actor.id, type: 'SALE', quantity: line.quantity, reference: receiptNo, referenceId: sale.id },
        { allowNegative: settings.allowNegativeStock, fefo: line.tracksExpiry },
      );
    }
    if (settings.loyalty.enabled && input.customerId) {
      const points = cart.total.div(settings.loyalty.unitAmount).floor().toNumber();
      await tx.customer.update({ where: { id: input.customerId }, data: { loyaltyPoints: { increment: points } } });
    }

    await audit(tx, actor, { action: 'SALE', entity: 'Sale', entityId: sale.id, branchId: session.branchId, after: { receiptNo, total: cart.total, offline: input.offline } });
    if (cart.discountTotal.gt(ZERO)) {
      const lines = cart.lines.filter((l) => l.discount.gt(ZERO)).map((l) => ({ productId: l.productId, promo: l.promoDiscount, manual: l.manualDiscount }));
      await audit(tx, actor, { action: 'DISCOUNT', entity: 'Sale', entityId: sale.id, branchId: session.branchId, after: { total: cart.discountTotal, lines } });
    }
    return sale.id;
  });

/** An offline sale uploaded after its shift closed changes the takings: refresh the closed shift's expected cash and variance. */
const reconcileClosedShift = async (actor: Actor, sessionId: string) => {
  const session = await prisma.cashierSession.findUnique({ where: { id: sessionId } });
  if (!session || session.status !== 'CLOSED' || session.actualCash == null) return;
  const { expectedCash } = await sessionSummary(sessionId);
  const difference = Decimal.sub(session.actualCash, expectedCash);
  await prisma.cashierSession.update({ where: { id: sessionId }, data: { expectedCash, difference } });
  await audit(prisma, actor, { action: 'SESSION_RECONCILE', entity: 'CashierSession', entityId: sessionId, branchId: session.branchId, before: { expectedCash: session.expectedCash, difference: session.difference }, after: { expectedCash, difference, reason: 'Late offline sale uploaded' } });
};

/** Creates a sale. Replaying the same clientId (e.g. offline sync retry) returns the original sale. */
export const createSale = async (actor: Actor, input: CreateSaleInput) => {
  const existing = await loadSale(prisma, { clientId: input.clientId });
  if (existing) return { sale: existing, duplicate: true };
  try {
    const id = await createSaleTx(actor, input);
    const sale = (await loadSale(prisma, { id }))!;
    await reconcileClosedShift(actor, sale.sessionId);
    return { sale, duplicate: false };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const raced = await loadSale(prisma, { clientId: input.clientId });
      if (raced) return { sale: raced, duplicate: true };
    }
    throw err;
  }
};

export const voidSale = async (actor: Actor, id: string, reason: string, approval: CreateSaleInput['approval']) => {
  const voided = await transact(async (tx) => {
    const sale = await tx.sale.findUnique({ where: { id }, include: { returns: { select: { id: true } } } });
    if (!sale) throw notFound('Sale');
    branchFor(actor, sale.branchId);
    if (sale.status === 'VOIDED') throw conflict('Sale is already voided');
    if (sale.returns.length) throw conflict('Sales with returns cannot be voided');

    const approver = await authorizeAction(tx, actor, P.SALE_VOID, approval, sale.branchId, { action: 'VOID', entity: 'Sale', entityId: id });
    const movements = await tx.stockMovement.findMany({ where: { referenceId: id, type: 'SALE' } });
    for (const m of movements) {
      await addStock(tx, {
        productId: m.productId, branchId: m.branchId, userId: actor.id, type: 'RETURN', quantity: m.quantity.abs(),
        reference: sale.receiptNo, referenceId: id, notes: `Void: ${reason}`, batchId: m.batchId,
      });
    }
    const settings = await getSettings(tx);
    if (settings.loyalty.enabled && sale.customerId) {
      const points = sale.total.div(settings.loyalty.unitAmount).floor().toNumber();
      await tx.customer.update({ where: { id: sale.customerId }, data: { loyaltyPoints: { decrement: points } } });
    }
    const voided = await tx.sale.update({ where: { id }, data: { status: 'VOIDED', voidedAt: new Date(), voidedById: approver.id, voidReason: reason } });
    await audit(tx, actor, { action: 'VOID', entity: 'Sale', entityId: id, branchId: sale.branchId, before: { status: sale.status }, after: { status: 'VOIDED', reason, approvedBy: approver.id } });
    return voided;
  });
  // A void after the shift was closed changes its takings: refresh the expected cash and variance.
  await reconcileClosedShift(actor, voided.sessionId);
  return voided;
};

export const getSale = async (actor: Actor, id: string) => {
  const sale = await loadSale(prisma, { id });
  if (!sale) throw notFound('Sale');
  branchFor(actor, sale.branchId);
  if (!can(actor.role, P.SALE_READ_ALL) && sale.cashierId !== actor.id) throw forbidden();
  const names = await userNames([sale.cashierId]);
  return { ...sale, cashierName: names.get(sale.cashierId) ?? null };
};

export const listSales = async (actor: Actor, q: SaleListQuery) => {
  const where: Prisma.SaleWhereInput = {
    branchId: branchFor(actor, q.branchId),
    cashierId: can(actor.role, P.SALE_READ_ALL) ? q.cashierId : actor.id,
    status: q.status,
    soldAt: { gte: q.from, lte: q.to },
    ...(q.search && { receiptNo: { contains: q.search } }),
  };
  const [rows, total] = await Promise.all([
    prisma.sale.findMany({ where, orderBy: { soldAt: 'desc' }, include: { payments: true }, ...pageArgs(q) }),
    prisma.sale.count({ where }),
  ]);
  const names = await userNames(rows.map((r) => r.cashierId));
  return pageResult(rows.map((r) => ({ ...r, cashierName: names.get(r.cashierId) ?? null })), total, q);
};

export const getReceipt = async (actor: Actor, id: string) => {
  const sale = await getSale(actor, id);
  const [settings, branch] = await Promise.all([getSettings(), prisma.branch.findUnique({ where: { id: sale.branchId } })]);
  return { sale, store: { ...settings.receipt, branch: branch?.name, address: branch?.address, phone: branch?.phone } };
};

export const holdSale = async (actor: Actor, label: string | undefined, payload: unknown) => {
  if (!actor.branchId) throw badRequest('Held sales require a branch');
  if ((await prisma.heldSale.count({ where: { userId: actor.id } })) >= MAX_HELD_SALES) throw conflict('Too many held sales, resume or clear some first');
  return prisma.heldSale.create({ data: { branchId: actor.branchId, userId: actor.id, label, payload: payload as Prisma.InputJsonValue } });
};

export const listHeld = (actor: Actor) =>
  prisma.heldSale.findMany({ where: { userId: actor.id, branchId: actor.branchId! }, orderBy: { createdAt: 'desc' } });

export const takeHeld = async (actor: Actor, id: string) => {
  const held = await prisma.heldSale.findFirst({ where: { id, userId: actor.id } });
  if (!held) throw notFound('Held sale');
  await prisma.heldSale.delete({ where: { id } });
  return held;
};

