import type { Promotion } from '@prisma/client';
import { d, Decimal, money, ZERO, type Num } from './money';

type Rule = Pick<Promotion, 'type' | 'value' | 'minQty' | 'buyQty' | 'getQty'>;

/** Discount (in currency) a promotion gives on a line. Never exceeds the line value. */
export const promotionDiscount = (rule: Rule, quantity: Decimal, unitPrice: Decimal): Decimal => {
  const gross = quantity.mul(unitPrice);
  const value = d(rule.value);
  const belowPrice = value.lt(unitPrice) ? unitPrice.minus(value).mul(quantity) : ZERO;
  const amount = (() => {
    switch (rule.type) {
      case 'PERCENT': return gross.mul(value).div(100);
      case 'FIXED': return value.mul(quantity);
      case 'PROMO_PRICE': return belowPrice;
      case 'BULK': return quantity.gte(rule.minQty) ? belowPrice : ZERO;
      case 'BOGO': return unitPrice.mul(quantity.div(rule.buyQty + rule.getQty).floor().mul(rule.getQty));
    }
  })();
  return money(Decimal.min(amount, gross));
};

export const bestPromotion = (rules: Rule[], quantity: Decimal, unitPrice: Decimal) =>
  rules.reduce((best, rule) => Decimal.max(best, promotionDiscount(rule, quantity, unitPrice)), ZERO);

/** Tax contained in a tax-inclusive amount. */
export const inclusiveTax = (amount: Decimal, ratePercent: Num) =>
  money(amount.mul(ratePercent).div(d(100).plus(ratePercent)));
