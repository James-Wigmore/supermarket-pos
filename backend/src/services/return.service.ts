import type { Prisma } from '@prisma/client';
import { audit } from '../lib/audit';
import { badRequest, conflict, notFound } from '../lib/errors';
import { d, money, sum } from '../lib/money';
import { pageArgs, pageResult, type PageQuery } from '../lib/pagination';
import { P } from '../lib/permissions';
import { prisma, transact } from '../lib/prisma';
import { branchFor } from '../lib/scope';
import { nextNumber } from '../lib/sequence';
import type { Actor } from '../types';
import type { CreateReturnInput } from '../validators/session';
import { authorizeAction } from './approval.service';
import { addStock } from './stock.service';

/** Return linked to the original sale: the sale itself is never altered apart from returned quantities. */
export const createReturn = (actor: Actor, input: CreateReturnInput) =>
  transact(async (tx) => {
    const sale = await tx.sale.findUnique({ where: { id: input.saleId }, include: { items: true } });
    if (!sale) throw notFound('Sale');
    branchFor(actor, sale.branchId);
    if (sale.status === 'VOIDED') throw conflict('Voided sales cannot be returned');

    const approver = await authorizeAction(tx, actor, P.REFUND, input.approval, sale.branchId, { action: 'REFUND', entity: 'Sale', entityId: sale.id });
    const items = new Map(sale.items.map((item) => [item.id, item]));
    const returnNo = await nextNumber(tx, 'RTN');
    const open = await tx.cashierSession.findFirst({ where: { cashierId: actor.id, status: 'OPEN' }, select: { id: true } });

    const lines = input.items.map((line) => {
      const item = items.get(line.saleItemId);
      if (!item) throw badRequest('Item does not belong to this sale');
      const quantity = d(line.quantity);
      if (quantity.gt(d(item.quantity).minus(item.returnedQty))) throw badRequest(`Cannot return more than was sold for ${item.name}`);
      return { item, quantity, restock: line.restock, amount: money(d(item.lineTotal).mul(quantity).div(item.quantity)) };
    });

    const refundAmount = sum(lines.map((l) => l.amount));
    const created = await tx.return.create({
      data: {
        number: returnNo, saleId: sale.id, branchId: sale.branchId, sessionId: open?.id, userId: actor.id,
        approvedById: approver.id, method: input.method, refundAmount, reason: input.reason,
        items: { create: lines.map((l) => ({ saleItemId: l.item.id, quantity: l.quantity, amount: l.amount, restock: l.restock })) },
      },
      include: { items: true },
    });

    for (const { item, quantity, restock } of lines) {
      await tx.saleItem.update({ where: { id: item.id }, data: { returnedQty: { increment: quantity } } });
      if (!restock) continue;
      const original = await tx.stockMovement.findFirst({ where: { referenceId: sale.id, productId: item.productId, type: 'SALE', batchId: { not: null } } });
      await addStock(tx, {
        productId: item.productId, branchId: sale.branchId, userId: actor.id, type: 'RETURN', quantity,
        unitCost: item.unitCost, reference: returnNo, referenceId: created.id, notes: input.reason, batchId: original?.batchId,
      });
    }
    await audit(tx, actor, { action: 'REFUND', entity: 'Return', entityId: created.id, branchId: sale.branchId, after: { number: returnNo, saleId: sale.id, refundAmount, approvedBy: approver.id } });
    return created;
  });

export const listReturns = async (actor: Actor, page: PageQuery & { branchId?: string }) => {
  const where: Prisma.ReturnWhereInput = { branchId: branchFor(actor, page.branchId) };
  const [rows, total] = await Promise.all([
    prisma.return.findMany({ where, orderBy: { createdAt: 'desc' }, include: { sale: { select: { receiptNo: true } } }, ...pageArgs(page) }),
    prisma.return.count({ where }),
  ]);
  return pageResult(rows, total, page);
};
