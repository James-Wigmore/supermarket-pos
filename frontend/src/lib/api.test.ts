import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, printFile } from './api';
import type { PosBridge } from '../../../desktop/bridge';

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

describe('printing a label sheet or other PDF', () => {
  afterEach(() => { delete (window as { pos?: PosBridge }).pos; });

  it('in a browser, opens it in a new tab instead of saving a file', async () => {
    reply('%PDF-1.4', { status: 200, headers: { 'Content-Type': 'application/pdf' } });
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    await printFile('/products/labels.pdf', { ids: '1,2' });
    expect(open).toHaveBeenCalledWith(expect.stringContaining('blob:'), '_blank');
  });

  it('in the desktop app, hands the bytes to the PC\'s own print view, never a download', async () => {
    const printFileCall = vi.fn(async () => undefined);
    const request = vi.fn(async () => ({ status: 200, contentType: 'application/pdf', disposition: '', body: new Uint8Array([0x25, 0x50, 0x44, 0x46]) }));
    (window as { pos?: Partial<PosBridge> }).pos = { request, printFile: printFileCall } as unknown as PosBridge;
    const open = vi.spyOn(window, 'open');
    await printFile('/products/labels.pdf', undefined);
    expect(printFileCall).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });
});
