import { lookupExternalProduct } from '../lib/barcode-provider';
import { can, P } from '../lib/permissions';
import { prisma } from '../lib/prisma';
import { branchFor } from '../lib/scope';
import type { Actor } from '../types';
import { activePromotions } from './pricing.service';
import { hideCost, productInclude, withPriceAndStock } from './product.service';

interface LookupOptions {
  branchId?: string;
  supplierId?: string;
  external: boolean;
}

/**
 * Barcode lookup used by POS and receiving. Internal catalogue first; only staff who can create
 * products may trigger the external identification service.
 */
export const lookupBarcode = async (actor: Actor, rawCode: string, options: LookupOptions) => {
  const code = rawCode.trim();
  const found = await prisma.barcode.findUnique({ where: { code }, include: { product: { include: productInclude } } });

  if (found) {
    const [product] = await withPriceAndStock(prisma, [found.product], branchFor(actor, options.branchId));
    const [promotions, supplierPrice] = await Promise.all([
      activePromotions(prisma, [found.productId]),
      options.supplierId
        ? prisma.supplierPrice.findUnique({ where: { supplierId_productId: { supplierId: options.supplierId, productId: found.productId } } })
        : null,
    ]);
    const visible = can(actor.role, P.PURCHASE_READ);
    return { source: 'internal' as const, product: { ...hideCost(actor, product!), promotions, supplierPrice: visible ? supplierPrice?.unitCost ?? null : null } };
  }

  if (!options.external || !can(actor.role, P.PRODUCT_WRITE)) return { source: 'none' as const };
  const { suggestion, failed } = await lookupExternalProduct(code);
  if (suggestion) return { source: 'external' as const, suggestion };
  return { source: 'none' as const, lookupFailed: failed };
};
