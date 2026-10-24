import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from './api';

const reply = (body: string, init: ResponseInit) => vi.stubGlobal('fetch', vi.fn(async () => new Response(body, init)));
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => localStorage.clear());

describe('talking to a site that has no API', () => {
  it('turns a web page answer into a clear "no server" error instead of a JSON crash', async () => {
    reply('<!doctype html><html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    const err = await api('/branches').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toMatch(/VITE_API_URL/);
    expect((err as ApiError).isNetwork).toBe(true);
  });

  it('never shows an empty message when the server answers an error with no body', async () => {
    reply('', { status: 405, statusText: '' });
    const err = (await api('/auth/login', { method: 'POST', body: {} }).catch((e: unknown) => e)) as ApiError;
    expect(err.message).toMatch(/error 405/);
  });

  it('still returns normal JSON answers and server error messages', async () => {
    reply('{"ok":1}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    expect(await api('/x')).toEqual({ ok: 1 });
    reply('{"error":{"message":"Invalid email or password"}}', { status: 401, headers: { 'Content-Type': 'application/json' } });
    expect(((await api('/x').catch((e: unknown) => e)) as ApiError).message).toBe('Invalid email or password');
  });
});
