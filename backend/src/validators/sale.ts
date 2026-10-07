import { PaymentMethod, SaleStatus } from '@prisma/client';
import { z } from 'zod';
import { pageQuery } from '../lib/pagination';
import { amount, approvalSchema, dateInput, dateRange, id, positiveAmount, quantity } from './common';

export const cartLineSchema = z
  .object({
    productId: id,
    quantity,
    unitPrice: amount.optional(),
    discountPercent: z.coerce.number().min(0).max(100).optional(),
    discountAmount: amount.optional(),
  })
  .refine((l) => l.discountPercent === undefined || l.discountAmount === undefined, {
    message: 'Use either discountPercent or discountAmount',
  });

export const quoteSchema = z.object({ items: z.array(cartLineSchema).min(1).max(300) });

export const createSaleSchema = z.object({
  clientId: id,
  sessionId: id,
  customerId: id.optional(),
  soldAt: dateInput.optional(),
  offline: z.boolean().default(false),
  items: z.array(cartLineSchema).min(1).max(300),
  payments: z
    .array(z.object({ method: z.enum(PaymentMethod), amount: positiveAmount, reference: z.string().trim().max(100).optional() }))
    .max(6),
  approval: approvalSchema.optional(),
});

export const voidSaleSchema = z.object({ reason: z.string().trim().min(3).max(300), approval: approvalSchema.optional() });

export const saleListQuery = pageQuery.extend(dateRange.shape).extend({
  branchId: id.optional(),
  cashierId: id.optional(),
  status: z.enum(SaleStatus).optional(),
  search: z.string().trim().optional(),
});

export const heldSaleSchema = z.object({
  label: z.string().trim().max(60).optional(),
  payload: z.object({ items: z.array(z.record(z.string(), z.unknown())).min(1).max(300) }).passthrough(),
});

export type CartLine = z.infer<typeof cartLineSchema>;
export type CreateSaleInput = z.infer<typeof createSaleSchema>;
export type SaleListQuery = z.infer<typeof saleListQuery>;
