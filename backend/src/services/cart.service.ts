import { badRequest } from '../lib/errors';
import { d, money, sum, ZERO, type Decimal } from '../lib/money';
import { bestPromotion, inclusiveTax } from '../lib/pricing-rules';
import type { Db } from '../lib/prisma';
import type { CartLine } from '../validators/sale';
import { activePromotions, currentPrices } from './pricing.service';

export interface PricedLine {
  productId: string;
  name: string;
  tracksExpiry: boolean;
  quantity: Decimal;
  unitPrice: Decimal;
  unitCost: Decimal;
  taxRate: Decimal;
  promoDiscount: Decimal;
  manualDiscount: Decimal;
  manualPercent: Decimal;
  discount: Decimal;
  taxAmount: Decimal;
  lineTotal: Decimal;
  overridden: boolean;
}

export interface PricedCart {
  lines: PricedLine[];
  subtotal: Decimal;
  discountTotal: Decimal;
  taxTotal: Decimal;
  total: Decimal;
}

/**
 * Prices a cart server-side: effective price at `at`, best promotion, manual discount, inclusive tax.
 * A supplied unitPrice differing from the catalogue price is flagged as an override.
 */
export const priceCart = async (db: Db, items: CartLine[], at: Date): Promise<PricedCart> => {
  const ids = [...new Set(items.map((item) => item.productId))];
  // Sequential on purpose: `db` may be a transaction client bound to a single connection.
  const products = await db.product.findMany({ where: { id: { in: ids } } });
  const prices = await currentPrices(db, ids, at);
  const promotions = await activePromotions(db, ids, at);
  const byId = new Map(products.map((p) => [p.id, p]));

  const lines = items.map((item): PricedLine => {
    const product = byId.get(item.productId);
    if (!product) throw badRequest('Product not found in cart');
    if (!product.isActive) throw badRequest(`${product.name} is inactive and cannot be sold`);
    const catalogue = prices.get(product.id);
    if (!catalogue) throw badRequest(`${product.name} has no selling price`);

    const quantity = d(item.quantity);
    const unitPrice = item.unitPrice === undefined ? catalogue : money(item.unitPrice);
    const overridden = !unitPrice.eq(catalogue);
    const gross = money(quantity.mul(unitPrice));
    const promoDiscount = overridden
      ? ZERO
      : bestPromotion(promotions.filter((p) => !p.productId || p.productId === product.id), quantity, unitPrice);
    const afterPromo = gross.minus(promoDiscount);
    const requested = item.discountAmount !== undefined ? money(item.discountAmount) : money(afterPromo.mul(item.discountPercent ?? 0).div(100));
    const manualDiscount = requested.gt(afterPromo) ? afterPromo : requested;
    const lineTotal = afterPromo.minus(manualDiscount);

    return {
      productId: product.id, name: product.name, tracksExpiry: product.tracksExpiry,
      quantity, unitPrice, unitCost: d(product.purchasePrice), taxRate: d(product.taxRate),
      promoDiscount, manualDiscount,
      manualPercent: afterPromo.gt(0) ? manualDiscount.mul(100).div(afterPromo) : ZERO,
      discount: promoDiscount.plus(manualDiscount), taxAmount: inclusiveTax(lineTotal, product.taxRate),
      lineTotal, overridden,
    };
  });

  const total = sum(lines.map((l) => l.lineTotal));
  return {
    lines,
    subtotal: sum(lines.map((l) => l.lineTotal.plus(l.discount))),
    discountTotal: sum(lines.map((l) => l.discount)),
    taxTotal: sum(lines.map((l) => l.taxAmount)),
    total,
  };
};
