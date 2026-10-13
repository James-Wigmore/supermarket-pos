import { env } from '../config/env';
import { logger } from './logger';
import { prisma } from './prisma';
import { toJson } from './json';

export interface ProductSuggestion {
  barcode: string;
  name: string;
  brand?: string;
  manufacturer?: string;
  packageSize?: string;
  imageUrl?: string;
  category?: string;
  source: string;
}

const CACHE_TTL_MS = 90 * 24 * 3600_000;
const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

const DEFAULT_URLS = {
  openfoodfacts: 'https://world.openfoodfacts.org/api/v2/product/{barcode}.json?fields=product_name,brands,quantity,image_url,categories',
  upcitemdb: 'https://api.upcitemdb.com/prod/trial/lookup?upc={barcode}',
} as const;

type Json = Record<string, unknown>;

const mapOpenFoodFacts = (barcode: string, json: Json): ProductSuggestion | null => {
  const product = json.product as Json | undefined;
  const name = text(product?.product_name);
  if (json.status !== 1 || !product || !name) return null;
  const brand = text(product.brands)?.split(',')[0]?.trim();
  return {
    barcode, name, brand, manufacturer: brand, packageSize: text(product.quantity),
    imageUrl: text(product.image_url), category: text(product.categories)?.split(',')[0]?.trim(),
    source: 'openfoodfacts',
  };
};

const mapUpcItemDb = (barcode: string, json: Json): ProductSuggestion | null => {
  const item = (json.items as Json[] | undefined)?.[0];
  const name = text(item?.title);
  if (!item || !name) return null;
  const brand = text(item.brand);
  return {
    barcode, name, brand, manufacturer: brand, packageSize: text(item.size),
    imageUrl: text((item.images as unknown[] | undefined)?.[0]), category: text(item.category)?.split('>')[0]?.trim(),
    source: 'upcitemdb',
  };
};

const fetchProvider = async (barcode: string) => {
  const provider = env.BARCODE_LOOKUP_PROVIDER;
  if (provider === 'none') return null;
  const url = (env.BARCODE_LOOKUP_URL ?? DEFAULT_URLS[provider]).replace('{barcode}', encodeURIComponent(barcode));
  const response = await fetch(url, {
    headers: { Accept: 'application/json', ...(env.BARCODE_LOOKUP_API_KEY ? { user_key: env.BARCODE_LOOKUP_API_KEY } : {}) },
    signal: AbortSignal.timeout(env.BARCODE_LOOKUP_TIMEOUT_MS),
    redirect: 'error',
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Barcode service responded ${response.status}`);
  const json = (await response.json()) as Json;
  return provider === 'openfoodfacts' ? mapOpenFoodFacts(barcode, json) : mapUpcItemDb(barcode, json);
};

/**
 * Identification data for an unknown barcode. Cached locally; failures never block the caller
 * (staff can always create the product manually).
 */
export const lookupExternalProduct = async (barcode: string) => {
  // Only EAN/UPC style codes are sent to the online service; internal or odd codes never are.
  if (!/^\d{6,14}$/.test(barcode)) return { suggestion: null, failed: false };
  const cached = await prisma.externalProductCache.findUnique({ where: { barcode } });
  if (cached && Date.now() - cached.fetchedAt.getTime() < CACHE_TTL_MS) {
    return { suggestion: cached.data as unknown as ProductSuggestion, failed: false };
  }
  try {
    const suggestion = await fetchProvider(barcode);
    if (suggestion) {
      const data = toJson(suggestion)!;
      await prisma.externalProductCache.upsert({
        where: { barcode }, create: { barcode, data }, update: { data, fetchedAt: new Date() },
      });
    }
    return { suggestion, failed: false };
  } catch (err) {
    logger.warn({ err, barcode }, 'External barcode lookup failed');
    return { suggestion: null, failed: true };
  }
};
