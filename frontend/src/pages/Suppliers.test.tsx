import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json, page, renderApp, stubApi, stubBrowser } from '../test/utils';
import { Suppliers } from './Suppliers';

vi.mock('../lib/auth', () => ({ useAuth: () => ({ session: { user: { role: 'MANAGER' } }, can: () => true, canAny: () => true }) }));

let supplier = { id: 's1', name: 'Acme', contact: null, phone: null, email: null, address: null, balance: 0, isActive: true };
let calls: ReturnType<typeof stubApi>;
beforeEach(() => {
  stubBrowser();
  supplier = { id: 's1', name: 'Acme', contact: null, phone: null, email: null, address: null, balance: 0, isActive: true };
  calls = stubApi((url, { method, body }) => {
    if (url.startsWith('/suppliers') && method === 'GET') return json(page([supplier]));
    if (url === '/suppliers/s1' && method === 'PATCH') {
      supplier = { ...supplier, isActive: Boolean(body?.isActive) };
      return json(supplier);
    }
    return undefined;
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('supplier selection management', () => {
  it('removes suppliers from new selections and allows restoring them', async () => {
    renderApp(<Suppliers />);
    await screen.findByText('Acme');

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' }).at(-1)!);
    await waitFor(() => expect(calls.some((call) => call.method === 'PATCH' && call.url === '/suppliers/s1' && call.body?.isActive === false)).toBe(true));
    expect(await screen.findByText('Inactive')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Restore' }).at(-1)!);
    await waitFor(() => expect(calls.some((call) => call.method === 'PATCH' && call.url === '/suppliers/s1' && call.body?.isActive === true)).toBe(true));
  });
});
