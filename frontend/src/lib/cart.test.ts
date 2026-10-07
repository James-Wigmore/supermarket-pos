import { describe, expect, it } from 'vitest';
import { addToCart, localTotals, parseScan, settle, type CartItem } from './cart';

const item = (over: Partial<CartItem> = {}): CartItem => ({ productId: 'a', name: 'A', unit: 'pcs', price: 1000, stock: 10, quantity: 1, ...over });

describe('cart', () => {
  it('parses quantity prefixes from the scan box', () => {
    expect(parseScan('3*6001000000011')).toEqual({ quantity: 3, code: '6001000000011' });
    expect(parseScan(' 6001000000011 ')).toEqual({ quantity: 1, code: '6001000000011' });
  });

  it('merges repeated scans into one line', () => {
    const cart = addToCart(addToCart([], item()), item());
    expect(cart).toHaveLength(1);
    expect(cart[0]?.quantity).toBe(2);
  });

  it('keeps discounted lines separate and totals correctly', () => {
    const cart = addToCart([item({ quantity: 2, discountPercent: 10 })], item());
    expect(cart).toHaveLength(2);
    expect(localTotals(cart)).toEqual({ subtotal: 3000, discount: 200, total: 2800 });
  });

  it('computes change and validates tendered amounts', () => {
    expect(settle(7300, [{ method: 'CASH', amount: 10000 }])).toMatchObject({ change: 2700, valid: true });
    expect(settle(7300, [{ method: 'CASH', amount: 5000 }])).toMatchObject({ remaining: 2300, valid: false });
    expect(settle(5000, [{ method: 'CARD', amount: 6000 }]).valid).toBe(false);
  });
});
