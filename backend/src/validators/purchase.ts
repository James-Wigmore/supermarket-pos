import { PurchaseStatus } from '@prisma/client';
import { z } from 'zod';
import { pageQuery } from '../lib/pagination';
import { amount, dateInput, dateRange, id, positiveAmount, quantity } from './common';

const batchFields = {
  batchNo: z.string().trim().min(1).max(50).optional(),
  expiryDate: dateInput.optional(),
};

const lineSchema = z.object({ productId: id, quantity, unitCost: amount, ...batchFields });

export const createPurchaseSchema = z.object({
  clientRef: id.optional(),
  supplierId: id,
  branchId: id.optional(),
  notes: z.string().trim().max(300).optional(),
  items: z.array(lineSchema).min(1).max(500),
});

export const receivePurchaseSchema = z.object({
  items: z.array(z.object({ itemId: id, quantity, unitCost: amount.optional(), ...batchFields })).min(1),
});

export const supplierPaymentSchema = z.object({ amount: positiveAmount, note: z.string().trim().max(200).optional() });

export const purchaseListQuery = pageQuery.extend(dateRange.shape).extend({
  supplierId: id.optional(),
  branchId: id.optional(),
  status: z.enum(PurchaseStatus).optional(),
});

export type CreatePurchaseInput = z.infer<typeof createPurchaseSchema>;
export type ReceiveLineInput = z.infer<typeof receivePurchaseSchema>['items'][number];
export type PurchaseListQuery = z.infer<typeof purchaseListQuery>;
