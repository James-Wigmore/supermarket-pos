import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { vi } from 'vitest';
import { ToastProvider } from '../components/ui';

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
export const page = <T,>(data: T[]) => ({ data, meta: { page: 1, pageSize: 25, total: data.length, totalPages: 1 } });

interface Call { method: string; url: string; body?: Record<string, unknown> }
type Handler = (url: string, call: Call) => Response | undefined;

/** Replaces `fetch`; every request is recorded as { method, url (without /api), body }. */
export const stubApi = (handler: Handler) => {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = String(input).replace(/^\/api/, '');
    const call = { method: init.method ?? 'GET', url, body: typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined };
    calls.push(call);
    return handler(url, call) ?? json({ error: { message: `Unhandled ${call.method} ${url}` } }, 404);
  }));
  return calls;
};

/** jsdom has no modal dialogs or blob URLs. */
export const stubBrowser = () => {
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };
  URL.createObjectURL = vi.fn(() => 'blob:test');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  vi.spyOn(window, 'open').mockImplementation(() => null);
};

export const renderApp = (ui: ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { client, ...render(<QueryClientProvider client={client}><ToastProvider>{ui}</ToastProvider></QueryClientProvider>) };
};
