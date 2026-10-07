import { MovementType } from '@prisma/client';
import { z } from 'zod';
import { pageQuery } from '../lib/pagination';
import { dateInput, id, quantity, dateRange } from './common';

export const ADJUSTMENT_TYPES = ['OPENING', 'DAMAGED', 'EXPIRED', 'LOSS', 'ADJUSTMENT'] as const;

export const adjustStockSchema = z
  .object({
    productId: id,
    branchId: id.optional(),
    type: z.enum(ADJUSTMENT_TYPES),
    direction: z.enum(['IN', 'OUT']).optional(),
    quantity,
    batchId: id.optional(),
    batchNo: z.string().trim().min(1).max(50).optional(),
    expiryDate: dateInput.optional(),
    notes: z.string().trim().min(3).max(300),
  })
  .refine((v) => v.type !== 'ADJUSTMENT' || v.direction, { message: 'direction is required for ADJUSTMENT', path: ['direction'] });

export const transferStockSchema = z.object({
  productId: id,
  fromBranchId: id.optional(),
  toBranchId: id,
  quantity,
  notes: z.string().trim().max(300).optional(),
});

export const stockOverviewQuery = pageQuery.extend({
  branchId: id.optional(),
  search: z.string().trim().optional(),
  categoryId: id.optional(),
  status: z.enum(['all', 'low', 'out']).default('all'),
});

export const movementQuery = pageQuery.extend(dateRange.shape).extend({
  branchId: id.optional(),
  productId: id.optional(),
  type: z.enum(MovementType).optional(),
});

export const batchQuery = pageQuery.extend({
  branchId: id.optional(),
  window: z.enum(['expired', 'today', '7', '30', 'all']).default('30'),
});

export type AdjustStockInput = z.infer<typeof adjustStockSchema>;
export type TransferStockInput = z.infer<typeof transferStockSchema>;
export type StockOverviewQuery = z.infer<typeof stockOverviewQuery>;
export type MovementQuery = z.infer<typeof movementQuery>;
export type BatchQuery = z.infer<typeof batchQuery>;
