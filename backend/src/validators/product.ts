import { z } from 'zod';
import { amount, dateInput, id } from './common';

// A selling price must be a real positive number: an unreadable entry (null) must never become a price of 0.
const price = z.union([z.number(), z.string().trim().min(1).transform(Number)]).pipe(z.number().positive().max(1e12));

const code = z.string().trim().min(3).max(64).regex(/^[\x21-\x7E]+$/, 'Barcode must be printable ASCII without spaces');

const productFields = {
  name: z.string().trim().min(1).max(200),
  sku: z.string().trim().min(1).max(64).optional(),
  brand: z.string().trim().max(100).optional(),
  manufacturer: z.string().trim().max(100).optional(),
  categoryId: id.nullable().optional(),
  supplierId: id.nullable().optional(),
  unit: z.string().trim().min(1).max(20).default('pcs'),
  packageSize: z.string().trim().max(50).optional(),
  imageUrl: z.url().max(500).optional(),
  purchasePrice: amount.default(0),
  taxRate: z.coerce.number().min(0).max(100).default(0),
  minStock: amount.default(0),
  maxStock: amount.nullable().optional(),
  tracksExpiry: z.boolean().default(false),
};

export const createProductSchema = z.object({
  ...productFields,
  sellingPrice: price,
  barcodes: z.array(code).max(10).default([]),
  generateBarcode: z.boolean().default(false),
});

export const updateProductSchema = z.object(productFields).partial().extend({ isActive: z.boolean().optional() });

export const addBarcodeSchema = z.object({ code });

export const setPriceSchema = z.object({
  newPrice: price,
  effectiveFrom: dateInput.optional(),
  reason: z.string().trim().max(200).optional(),
});

export const productListQuery = z.object({
  search: z.string().trim().optional(),
  categoryId: id.optional(),
  supplierId: id.optional(),
  isActive: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  branchId: id.optional(),
});

export const lookupQuery = z.object({
  branchId: id.optional(),
  supplierId: id.optional(),
  external: z.enum(['true', 'false']).transform((v) => v === 'true').default(false),
});

export const labelsQuery = z.object({
  ids: z.string().transform((v) => v.split(',')).pipe(z.array(id).min(1).max(100)),
  copies: z.coerce.number().int().min(1).max(50).default(1),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type SetPriceInput = z.infer<typeof setPriceSchema>;
