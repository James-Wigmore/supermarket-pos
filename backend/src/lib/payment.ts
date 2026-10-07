import type { PaymentMethod } from '@prisma/client';
import { badRequest } from './errors';
import { d, money, sum, ZERO, type Decimal, type Num } from './money';

export interface PaymentInput {
  method: PaymentMethod;
  amount: Num;
  reference?: string;
}

/**
 * Validates tendered payments against the total and returns the payments to record
 * (cash reduced by the change given) together with the change.
 */
export const settlePayments = (total: Decimal, payments: PaymentInput[]) => {
  const tendered = sum(payments.map((p) => p.amount));
  if (tendered.lt(total)) throw badRequest('Payment is less than the total due');

  const change = money(tendered.minus(total));
  const cash = sum(payments.filter((p) => p.method === 'CASH').map((p) => p.amount));
  if (change.gt(cash)) throw badRequest('Change can only be given from cash payments');

  let owed = change;
  const recorded = payments.map((p) => {
    if (p.method !== 'CASH' || owed.lte(ZERO)) return { ...p, amount: money(p.amount) };
    const deduct = owed.lt(p.amount) ? owed : d(p.amount);
    owed = owed.minus(deduct);
    return { ...p, amount: money(d(p.amount).minus(deduct)) };
  });
  return { change, recorded: recorded.filter((p) => p.amount.gt(ZERO)) };
};
