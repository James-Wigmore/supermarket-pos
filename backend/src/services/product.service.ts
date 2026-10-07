import type { Prisma } from '@prisma/client';
import { audit } from '../lib/audit';
import { conflict, notFound } from '../lib/errors';
import { d, money, ZERO, type Decimal } from '../lib/money';
import { pageArgs, pageResult, type PageQuery } from '../lib/pagination';
import { prisma, transact, type Db } from '../lib/prisma';
import { can, P } from '../lib/permissions';
import { branchFor } from '../lib/scope';
import { nextInternalBarcode, nextNumber } from '../lib/sequence';
import type { Actor } from '../types';
import type { CreateProductInput, UpdateProductInput } from '../validators/product';
import { currentPrices } from './pricing.service';

export const productInclude = {
  barcodes: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
  category: { select: { id: true, name: true } },
  supplier: { select: { id: true, name: true } },
} satisfies Prisma.ProductInclude;

type ProductWithRelations = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

/** Total stock per product, for one branch or (when undefined) across all branches. */
export const stockByProduct = async (db: Db, productIds: string[], branchId?: string) => {
  const rows = await db.stockLevel.groupBy({
    by: ['productId'],
    where: { productId: { in: productIds }, branchId },
    _sum: { quantity: true },
  });
  return new Map<string, Decimal>(rows.map((row) => [row.productId, d(row._sum.quantity)]));
};

/** Attaches the effective price and stock to products. */
export const withPriceAndStock = async (db: Db, products: ProductWithRelations[], branchId?: string) => {
  const ids = products.map((p) => p.id);
  const [prices, stock] = await Promise.all([currentPrices(db, ids), stockByProduct(db, ids, branchId)]);
  return products.map((p) => ({ ...p, price: prices.get(p.id) ?? null, stock: stock.get(p.id) ?? ZERO }));
};

/** Purchase cost is only visible to roles that work with purchasing. */
export const hideCost = <T extends { purchasePrice: unknown }>(actor: Actor, product: T) =>
  can(actor.role, P.PURCHASE_READ) ? product : { ...product, purchasePrice: null };

export interface ProductListFilter {
  search?: string;
  categoryId?: string;
  supplierId?: string;
  isActive?: boolean;
  branchId?: string;
}

export const listProducts = async (actor: Actor, filter: ProductListFilter, page: PageQuery) => {
  const search = filter.search;
  const where: Prisma.ProductWhereInput = {
    categoryId: filter.categoryId,
    supplierId: filter.supplierId,
    isActive: filter.isActive,
    ...(search && {
      OR: [
        { name: { contains: search } },
        { sku: { contains: search } },
        { brand: { contains: search } },
        { barcodes: { some: { code: { startsWith: search } } } },
      ],
    }),
  };
  const [rows, total] = await Promise.all([
    prisma.product.findMany({ where, include: productInclude, orderBy: { name: 'asc' }, ...pageArgs(page) }),
    prisma.product.count({ where }),
  ]);
  const items = await withPriceAndStock(prisma, rows, branchFor(actor, filter.branchId));
  return pageResult(items.map((p) => hideCost(actor, p)), total, page);
};

export const getProduct = async (actor: Actor, id: string, branchId?: string) => {
  const product = await prisma.product.findUnique({ where: { id }, include: productInclude });
  if (!product) throw notFound('Product');
  return hideCost(actor, (await withPriceAndStock(prisma, [product], branchFor(actor, branchId)))[0]!);
};

const assertBarcodesFree = async (db: Db, codes: string[]) => {
  if (new Set(codes).size !== codes.length) throw conflict('Duplicate barcodes in request');
  const taken = await db.barcode.findFirst({ where: { code: { in: codes } }, include: { product: { select: { name: true } } } });
  if (taken) throw conflict(`Barcode ${taken.code} already belongs to "${taken.product.name}"`);
};

export const createProduct = (actor: Actor, input: CreateProductInput) =>
  transact(async (tx) => {
    const { barcodes, generateBarcode, sellingPrice, sku, ...data } = input;
    await assertBarcodesFree(tx, barcodes);
    const internal = generateBarcode ? await nextInternalBarcode(tx) : null;
    const entries = [...barcodes.map((code) => ({ code, isInternal: false })), ...(internal ? [{ code: internal, isInternal: true }] : [])];

    const product = await tx.product.create({
      data: {
        ...data,
        sku: sku ?? (await nextNumber(tx, 'SKU')),
        barcodes: { create: entries.map((entry, index) => ({ ...entry, isPrimary: index === 0 })) },
        prices: { create: { newPrice: money(sellingPrice), effectiveFrom: new Date(), userId: actor.id, reason: 'Initial price' } },
      },
      include: productInclude,
    });
    await audit(tx, actor, { action: 'PRODUCT_CREATE', entity: 'Product', entityId: product.id, after: { ...product, sellingPrice } });
    return product;
  });

export const updateProduct = async (actor: Actor, id: string, input: UpdateProductInput) => {
  const before = await prisma.product.findUnique({ where: { id } });
  if (!before) throw notFound('Product');
  const product = await prisma.product.update({ where: { id }, data: input, include: productInclude });
  await audit(prisma, actor, { action: 'PRODUCT_UPDATE', entity: 'Product', entityId: id, before, after: input });
  return product;
};

/** Deletes a product that was never used; otherwise it is deactivated to keep history intact. */
export const deleteProduct = (actor: Actor, id: string) =>
  transact(async (tx) => {
    const product = await tx.product.findUnique({ where: { id } });
    if (!product) throw notFound('Product');
    const inUse =
      (await tx.saleItem.count({ where: { productId: id } })) +
        (await tx.stockMovement.count({ where: { productId: id } })) +
        (await tx.purchaseItem.count({ where: { productId: id } })) >
      0;
    if (inUse) {
      await tx.product.update({ where: { id }, data: { isActive: false } });
    } else {
      await tx.priceHistory.deleteMany({ where: { productId: id } });
      await tx.stockLevel.deleteMany({ where: { productId: id } });
      await tx.supplierPrice.deleteMany({ where: { productId: id } });
      await tx.promotion.deleteMany({ where: { productId: id } });
      await tx.product.delete({ where: { id } });
    }
    await audit(tx, actor, { action: inUse ? 'PRODUCT_DEACTIVATE' : 'PRODUCT_DELETE', entity: 'Product', entityId: id, before: product });
    return { deleted: !inUse, deactivated: inUse };
  });

export const addBarcode = (actor: Actor, productId: string, code: string, isInternal = false) =>
  transact(async (tx) => {
    const product = await tx.product.findUnique({ where: { id: productId }, include: { barcodes: true } });
    if (!product) throw notFound('Product');
    await assertBarcodesFree(tx, [code]);
    const barcode = await tx.barcode.create({ data: { code, productId, isInternal, isPrimary: product.barcodes.length === 0 } });
    await audit(tx, actor, { action: 'BARCODE_ADD', entity: 'Product', entityId: productId, after: { code, isInternal } });
    return barcode;
  });

export const generateBarcode = async (actor: Actor, productId: string) =>
  addBarcode(actor, productId, await nextInternalBarcode(prisma), true);

export const removeBarcode = (actor: Actor, productId: string, barcodeId: string) =>
  transact(async (tx) => {
    const barcode = await tx.barcode.findFirst({ where: { id: barcodeId, productId } });
    if (!barcode) throw notFound('Barcode');
    await tx.barcode.delete({ where: { id: barcodeId } });
    if (barcode.isPrimary) {
      const next = await tx.barcode.findFirst({ where: { productId }, orderBy: { createdAt: 'asc' } });
      if (next) await tx.barcode.update({ where: { id: next.id }, data: { isPrimary: true } });
    }
    await audit(tx, actor, { action: 'BARCODE_REMOVE', entity: 'Product', entityId: productId, before: { code: barcode.code } });
  });
