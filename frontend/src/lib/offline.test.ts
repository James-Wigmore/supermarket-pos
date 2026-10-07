import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queue, syncQueue, type PendingSale } from './offline';
import type { Sale } from './types';

const pending = (clientId: string, createdAt: number): PendingSale => ({
  clientId, createdAt, status: 'pending', body: { clientId, items: [], payments: [] }, receipt: { id: clientId } as unknown as Sale,
});

const respond = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(async () => {
  for (const item of await queue.list()) await queue.remove(item.clientId);
});
afterEach(() => vi.unstubAllGlobals());

describe('offline sale queue', () => {
  it('uploads queued sales in order and clears them once the server accepts', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => { calls.push(JSON.parse(init.body as string).clientId); return respond(201); }));
    await queue.add(pending('b', 2));
    await queue.add(pending('a', 1));
    expect(await syncQueue()).toEqual({ sent: 2 });
    expect(calls).toEqual(['a', 'b']);
    expect(await queue.list()).toHaveLength(0);
  });

  it('keeps sales queued when the network is down, so nothing is lost', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    await queue.add(pending('a', 1));
    await queue.add(pending('b', 2));
    expect(await syncQueue()).toEqual({ sent: 0 });
    expect((await queue.list()).map((i) => i.status)).toEqual(['pending', 'pending']);
  });

  it('marks rejected sales as failed instead of retrying forever, and continues with the rest', async () => {
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async () => (++n === 1 ? respond(400, { error: { message: 'Payment is less than the total due' } }) : respond(201))));
    await queue.add(pending('a', 1));
    await queue.add(pending('b', 2));
    expect(await syncQueue()).toEqual({ sent: 1 });
    const [left] = await queue.list();
    expect(left).toMatchObject({ clientId: 'a', status: 'failed', error: 'Payment is less than the total due' });
  });

  it('stops on server errors and retries the same sale later (server de-duplicates by clientId)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(503)));
    await queue.add(pending('a', 1));
    expect(await syncQueue()).toEqual({ sent: 0 });
    expect((await queue.list())[0]?.status).toBe('pending');
  });
});
