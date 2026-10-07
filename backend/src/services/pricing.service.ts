import { audit } from '../lib/audit';
import { badRequest, notFound } from '../lib/errors';
import { d, money, type Decimal } from '../lib/money';
import { prisma, transact, type Db } from '../lib/prisma';
import type { Actor } from '../types';
import type { SetPriceInput } from '../validators/product';

/** Price in force for each product at the given moment (latest effective history row). */
export const currentPrices = async (db: Db, productIds: string[], at = new Date()) => {
  const rows = await db.priceHistory.findMany({
    where: { productId: { in: productIds }, effectiveFrom: { lte: at } },
    orderBy: [{ productId: 'asc' }, { effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    distinct: ['productId'],
    select: { productId: true, newPrice: true },
  });
  return new Map<string, Decimal>(rows.map((row) => [row.productId, d(row.newPrice)]));
};

export const priceHistory = (productId: string) =>
  prisma.priceHistory.findMany({ where: { productId }, orderBy: { effectiveFrom: 'desc' } });

/** Adds a price row. History is append-only; future effective dates schedule a price. */
export const setPrice = (actor: Actor, productId: string, input: SetPriceInput) =>
  transact(async (tx) => {
    const product = await tx.product.findUnique({ where: { id: productId }, select: { id: true } });
    if (!product) throw notFound('Product');

    const now = new Date();
    const effectiveFrom = input.effectiveFrom ?? now;
    if (effectiveFrom.getTime() < now.getTime() - 60_000) throw badRequest('Effective date cannot be in the past');

    const previous = (await currentPrices(tx, [productId], effectiveFrom)).get(productId) ?? null;
    const entry = await tx.priceHistory.create({
      data: { productId, oldPrice: previous, newPrice: money(input.newPrice), effectiveFrom, userId: actor.id, reason: input.reason },
    });
    await audit(tx, actor, {
      action: 'PRICE_CHANGE', entity: 'Product', entityId: productId,
      before: { price: previous }, after: { price: entry.newPrice, effectiveFrom, reason: input.reason },
    });
    return entry;
  });

/** Promotions in force at the given moment that apply to any of the products (or to all). */
export const activePromotions = (db: Db, productIds: string[], at = new Date()) =>
  db.promotion.findMany({
    where: {
      isActive: true,
      startsAt: { lte: at },
      AND: [
        { OR: [{ endsAt: null }, { endsAt: { gte: at } }] },
        { OR: [{ productId: null }, { productId: { in: productIds } }] },
      ],
    },
  });
