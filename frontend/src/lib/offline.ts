import { openDB } from 'idb';
import { ApiError, api } from './api';
import type { LookupProduct, Sale } from './types';

export interface PendingSale {
  clientId: string;
  body: Record<string, unknown>;
  receipt: Sale;
  createdAt: number;
  status: 'pending' | 'failed';
  error?: string;
}

interface CachedProduct {
  code: string;
  product: LookupProduct;
  cachedAt: number;
}

const db = openDB('pos-offline', 1, {
  upgrade(database) {
    database.createObjectStore('queue', { keyPath: 'clientId' });
    database.createObjectStore('products', { keyPath: 'code' });
  },
});

export const QUEUE_EVENT = 'pos:queue';
const notify = () => window.dispatchEvent(new Event(QUEUE_EVENT));

export const queue = {
  async add(item: PendingSale) {
    await (await db).put('queue', item);
    notify();
  },
  async list() {
    return ((await (await db).getAll('queue')) as PendingSale[]).sort((a, b) => a.createdAt - b.createdAt);
  },
  async remove(clientId: string) {
    await (await db).delete('queue', clientId);
    notify();
  },
  async fail(item: PendingSale, error: string) {
    await (await db).put('queue', { ...item, status: 'failed', error });
    notify();
  },
  async retryFailed() {
    const store = await db;
    for (const item of await this.list()) if (item.status === 'failed') await store.put('queue', { ...item, status: 'pending', error: undefined });
    notify();
  },
};

/** Product copies from earlier online scans, so those items can still be sold offline. */
export const productCache = {
  async put(product: LookupProduct) {
    const store = await db;
    await Promise.all(product.barcodes.map((b) => store.put('products', { code: b.code, product, cachedAt: Date.now() } satisfies CachedProduct)));
  },
  async byCode(code: string) {
    return ((await (await db).get('products', code)) as CachedProduct | undefined)?.product;
  },
  async search(text: string) {
    const needle = text.toLowerCase();
    const seen = new Map<string, LookupProduct>();
    for (const { product } of (await (await db).getAll('products')) as CachedProduct[]) {
      if (product.name.toLowerCase().includes(needle)) seen.set(product.id, product);
    }
    return [...seen.values()].slice(0, 10);
  },
};

let running = false;

/** Sends queued sales in order. Replays are safe: the server de-duplicates on clientId. */
export const syncQueue = async () => {
  if (running) return { sent: 0 };
  running = true;
  let sent = 0;
  try {
    for (const item of (await queue.list()).filter((i) => i.status === 'pending')) {
      try {
        await api('/sales', { method: 'POST', body: item.body });
        await queue.remove(item.clientId);
        sent++;
      } catch (err) {
        if (!(err instanceof ApiError)) throw err;
        if (err.isNetwork || err.status === 401 || err.status >= 500) break;
        await queue.fail(item, err.message);
      }
    }
  } finally {
    running = false;
  }
  return { sent };
};
