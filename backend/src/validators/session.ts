import { PaymentMethod } from '@prisma/client';
import { z } from 'zod';
import { pageQuery } from '../lib/pagination';
import { amount, approvalSchema, dateRange, id, quantity } from './common';

export const openSessionSchema = z.object({ registerId: id, openingCash: amount });
export const closeSessionSchema = z.object({ actualCash: amount, notes: z.string().trim().max(300).optional() });

export const sessionListQuery = pageQuery.extend(dateRange.shape).extend({
  branchId: id.optional(),
  cashierId: id.optional(),
  status: z.enum(['OPEN', 'CLOSED']).optional(),
});

export const createReturnSchema = z.object({
  saleId: id,
  method: z.enum(PaymentMethod).default('CASH'),
  reason: z.string().trim().min(3).max(300),
  items: z.array(z.object({ saleItemId: id, quantity, restock: z.boolean().default(true) })).min(1),
  approval: approvalSchema.optional(),
});

export type SessionListQuery = z.infer<typeof sessionListQuery>;
export type CreateReturnInput = z.infer<typeof createReturnSchema>;
