import { Prisma } from '@prisma/client';
import { audit } from '../lib/audit';
import { conflict, forbidden, notFound } from '../lib/errors';
import { userNames } from '../lib/lookups';
import { d, money, sum, ZERO } from '../lib/money';
import { pageArgs, pageResult } from '../lib/pagination';
import { can, P } from '../lib/permissions';
import { prisma, transact } from '../lib/prisma';
import { branchFor } from '../lib/scope';
import type { Actor } from '../types';
import type { SessionListQuery } from '../validators/session';

/** Takings summary of one shift: sales by method, refunds, discounts, voids and expected cash. */
export const sessionSummary = async (sessionId: string) => {
  const session = await prisma.cashierSession.findUnique({ where: { id: sessionId } });
  if (!session) throw notFound('Session');
  const [payments, sales, voids, refunds] = await Promise.all([
    prisma.payment.groupBy({ by: ['method'], where: { sale: { sessionId, status: 'COMPLETED' } }, _sum: { amount: true } }),
    prisma.sale.aggregate({ where: { sessionId, status: 'COMPLETED' }, _sum: { total: true, discountTotal: true }, _count: true }),
    prisma.sale.aggregate({ where: { sessionId, status: 'VOIDED' }, _sum: { total: true }, _count: true }),
    prisma.return.groupBy({ by: ['method'], where: { sessionId }, _sum: { refundAmount: true } }),
  ]);
  const paid = (method: string) => d(payments.find((p) => p.method === method)?._sum.amount);
  const refunded = (method: string) => d(refunds.find((r) => r.method === method)?._sum.refundAmount);
  const cashSales = paid('CASH');
  const cashRefunds = refunded('CASH');
  return {
    session,
    salesCount: sales._count,
    salesTotal: d(sales._sum.total),
    discounts: d(sales._sum.discountTotal),
    cashSales,
    mobileMoney: paid('MOBILE_MONEY'),
    card: paid('CARD'),
    other: paid('OTHER'),
    refunds: sum(refunds.map((r) => d(r._sum.refundAmount))),
    cashRefunds,
    voidsCount: voids._count,
    voidsTotal: d(voids._sum.total),
    expectedCash: money(d(session.openingCash).plus(cashSales).minus(cashRefunds)),
  };
};

export const openSession = async (actor: Actor, registerId: string, openingCash: number) => {
  const register = await prisma.register.findFirst({ where: { id: registerId, isActive: true } });
  if (!register) throw notFound('Register');
  branchFor(actor, register.branchId);
  try {
    const session = await prisma.cashierSession.create({
      data: { registerId, branchId: register.branchId, cashierId: actor.id, openingCash: money(openingCash) },
      include: { register: { select: { name: true } } },
    });
    await audit(prisma, actor, { action: 'SESSION_OPEN', entity: 'CashierSession', entityId: session.id, branchId: session.branchId, after: { registerId, openingCash } });
    return session;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw conflict('You already have an open shift, or this register is in use by another cashier');
    }
    throw err;
  }
};

export const currentSession = (actor: Actor) =>
  prisma.cashierSession.findFirst({ where: { cashierId: actor.id, status: 'OPEN' }, include: { register: { select: { name: true } } } });

export const closeSession = (actor: Actor, id: string, actualCash: number, notes?: string) =>
  transact(async (tx) => {
    const session = await tx.cashierSession.findUnique({ where: { id } });
    if (!session) throw notFound('Session');
    branchFor(actor, session.branchId);
    if (session.cashierId !== actor.id && !can(actor.role, P.USER_MANAGE)) throw forbidden('Only the cashier or a manager can close this shift');
    if (session.status === 'CLOSED') throw conflict('Shift is already closed');

    const { expectedCash } = await sessionSummary(id);
    const difference = money(actualCash).minus(expectedCash);
    const closed = await tx.cashierSession.update({
      where: { id },
      data: { status: 'CLOSED', closedAt: new Date(), expectedCash, actualCash: money(actualCash), difference, notes },
    });
    await audit(tx, actor, {
      action: 'SESSION_CLOSE', entity: 'CashierSession', entityId: id, branchId: session.branchId,
      after: { expectedCash, actualCash, difference, shortage: difference.lt(ZERO), notes },
    });
    return closed;
  });

/** A manager corrects the counted cash of a CLOSED shift (a mistyped count). The original figures are kept in the audit log. */
export const recountSession = (actor: Actor, id: string, actualCash: number, reason: string) =>
  transact(async (tx) => {
    const session = await tx.cashierSession.findUnique({ where: { id } });
    if (!session) throw notFound('Session');
    branchFor(actor, session.branchId);
    if (session.status !== 'CLOSED') throw conflict('Only a closed shift can be recounted');
    if (session.cashierId === actor.id && actor.role !== 'SUPER_ADMIN') throw forbidden('Someone other than the cashier must correct this count');
    const { expectedCash } = await sessionSummary(id);
    const difference = money(actualCash).minus(expectedCash);
    const updated = await tx.cashierSession.update({ where: { id }, data: { expectedCash, actualCash: money(actualCash), difference } });
    await audit(tx, actor, {
      action: 'SESSION_RECOUNT', entity: 'CashierSession', entityId: id, branchId: session.branchId,
      before: { actualCash: session.actualCash, difference: session.difference }, after: { expectedCash, actualCash, difference, reason },
    });
    return updated;
  });

export const listSessions = async (actor: Actor, q: SessionListQuery) => {
  const where: Prisma.CashierSessionWhereInput = {
    branchId: branchFor(actor, q.branchId),
    cashierId: can(actor.role, P.SESSION_READ_ALL) ? q.cashierId : actor.id,
    status: q.status,
    openedAt: { gte: q.from, lte: q.to },
  };
  const [rows, total] = await Promise.all([
    prisma.cashierSession.findMany({ where, orderBy: { openedAt: 'desc' }, include: { register: { select: { name: true } } }, ...pageArgs(q) }),
    prisma.cashierSession.count({ where }),
  ]);
  const names = await userNames(rows.map((r) => r.cashierId));
  return pageResult(rows.map((r) => ({ ...r, cashierName: names.get(r.cashierId) ?? null })), total, q);
};

export const getSessionSummary = async (actor: Actor, id: string) => {
  const summary = await sessionSummary(id);
  branchFor(actor, summary.session.branchId);
  if (!can(actor.role, P.SESSION_READ_ALL) && summary.session.cashierId !== actor.id) throw forbidden();
  return summary;
};
