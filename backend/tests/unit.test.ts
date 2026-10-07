import { describe, expect, it } from 'vitest';
import { AppError } from '../src/lib/errors';
import { d } from '../src/lib/money';
import { settlePayments } from '../src/lib/payment';
import { promotionDiscount } from '../src/lib/pricing-rules';
import { can, P } from '../src/lib/permissions';

describe('payment and change calculation', () => {
  it('returns change from cash and records the net cash amount', () => {
    const { change, recorded } = settlePayments(d(7300), [{ method: 'CASH', amount: 10000 }]);
    expect(change.toNumber()).toBe(2700);
    expect(recorded.map((p) => p.amount.toNumber())).toEqual([7300]);
  });

  it('supports split payments and takes change only from cash', () => {
    const { change, recorded } = settlePayments(d(10000), [
      { method: 'MOBILE_MONEY', amount: 4000 },
      { method: 'CASH', amount: 7000 },
    ]);
    expect(change.toNumber()).toBe(1000);
    expect(recorded.map((p) => [p.method, p.amount.toNumber()])).toEqual([['MOBILE_MONEY', 4000], ['CASH', 6000]]);
  });

  it('rejects underpayment and change that cards cannot cover', () => {
    expect(() => settlePayments(d(5000), [{ method: 'CASH', amount: 4999 }])).toThrow(AppError);
    expect(() => settlePayments(d(5000), [{ method: 'CARD', amount: 6000 }])).toThrow(/cash/);
  });
});

describe('promotion pricing', () => {
  const rule = { value: d(0), minQty: d(1), buyQty: 1, getQty: 1 };
  it('applies percentage and fixed discounts', () => {
    expect(promotionDiscount({ ...rule, type: 'PERCENT', value: d(10) }, d(2), d(5000)).toNumber()).toBe(1000);
    expect(promotionDiscount({ ...rule, type: 'FIXED', value: d(500) }, d(3), d(5000)).toNumber()).toBe(1500);
  });
  it('applies bulk pricing only above the minimum quantity', () => {
    const bulk = { ...rule, type: 'BULK' as const, value: d(900), minQty: d(6) };
    expect(promotionDiscount(bulk, d(5), d(1000)).toNumber()).toBe(0);
    expect(promotionDiscount(bulk, d(6), d(1000)).toNumber()).toBe(600);
  });
  it('gives the free item in buy-one-get-one', () => {
    expect(promotionDiscount({ ...rule, type: 'BOGO' }, d(5), d(1000)).toNumber()).toBe(2000);
  });
});

describe('role permissions', () => {
  it('never grants cashiers restricted capabilities', () => {
    for (const p of [P.PRICE_WRITE, P.STOCK_ADJUST, P.PRODUCT_DELETE, P.SALE_VOID, P.REFUND, P.USER_MANAGE, P.PRICE_OVERRIDE]) {
      expect(can('CASHIER', p)).toBe(false);
    }
  });
  it('keeps auditors read-only', () => {
    expect(can('AUDITOR', P.AUDIT_READ)).toBe(true);
    expect(can('AUDITOR', P.SALE_CREATE)).toBe(false);
    expect(can('AUDITOR', P.STOCK_ADJUST)).toBe(false);
  });
});
