import type { LookupProduct, PaymentMethod } from './types';
import { num } from './format';

export interface CartItem {
  productId: string;
  name: string;
  unit: string;
  price: number;
  stock: number;
  quantity: number;
  unitPrice?: number;
  discountPercent?: number;
}

export interface Totals { subtotal: number; discount: number; total: number }

export const parseScan = (input: string) => {
  const match = /^(\d+(?:\.\d+)?)\*(.+)$/.exec(input.trim());
  return match ? { quantity: Number(match[1]), code: match[2]!.trim() } : { quantity: 1, code: input.trim() };
};

export const toCartItem = (p: Pick<LookupProduct, 'id' | 'name' | 'unit' | 'price' | 'stock'>, quantity = 1): CartItem => ({
  productId: p.id, name: p.name, unit: p.unit, price: num(p.price), stock: num(p.stock), quantity,
});

/** Adds a product, merging with an existing untouched line of the same product. */
export const addToCart = (cart: CartItem[], item: CartItem): CartItem[] => {
  const index = cart.findIndex((l) => l.productId === item.productId && l.unitPrice === undefined && l.discountPercent === undefined);
  if (index < 0) return [...cart, item];
  return cart.map((l, i) => (i === index ? { ...l, quantity: round(l.quantity + item.quantity, 3) } : l));
};

const round = (value: number, places = 2) => Math.round(value * 10 ** places) / 10 ** places;

export const lineGross = (l: CartItem) => round(l.quantity * (l.unitPrice ?? l.price));
export const lineDiscount = (l: CartItem) => round((lineGross(l) * (l.discountPercent ?? 0)) / 100);

/** Local estimate used offline or while the server quote loads. The server price is authoritative. */
export const localTotals = (cart: CartItem[]): Totals => {
  const subtotal = round(cart.reduce((s, l) => s + lineGross(l), 0));
  const discount = round(cart.reduce((s, l) => s + lineDiscount(l), 0));
  return { subtotal, discount, total: round(subtotal - discount) };
};

export const toSaleItems = (cart: CartItem[]) =>
  cart.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice, discountPercent: l.discountPercent }));

export interface PaymentRow { method: PaymentMethod; amount: number; reference?: string }

export const settle = (total: number, payments: PaymentRow[]) => {
  const tendered = round(payments.reduce((s, p) => s + p.amount, 0));
  const cash = payments.filter((p) => p.method === 'CASH').reduce((s, p) => s + p.amount, 0);
  const change = round(Math.max(0, tendered - total));
  return { tendered, change, remaining: round(Math.max(0, total - tendered)), valid: tendered >= total && change <= cash && tendered > 0 };
};
