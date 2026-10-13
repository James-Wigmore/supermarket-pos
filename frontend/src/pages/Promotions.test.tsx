import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json, page, renderApp, stubApi, stubBrowser } from '../test/utils';
import { Promotions } from './Promotions';

const promo = { id: 'pr1', name: 'Weekend milk', type: 'PERCENT', value: 10, minQty: 1, buyQty: 1, getQty: 1, productId: 'p1', product: { name: 'Milk' }, startsAt: '2026-10-01T08:00:00.000Z', endsAt: null, isActive: true };
let calls: ReturnType<typeof stubApi>;
beforeEach(() => {
  stubBrowser();
  calls = stubApi((url, { method }) => {
    if (url.startsWith('/promotions/') && ['PATCH', 'DELETE'].includes(method)) return method === 'DELETE' ? new Response(null, { status: 204 }) : json(promo);
    if (url.startsWith('/promotions')) return json(page([promo]));
    return undefined;
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('promotions', () => {
  it('edits an existing promotion with its current values and saves it with PATCH', async () => {
    renderApp(<Promotions />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect((await screen.findByLabelText('Name') as HTMLInputElement).value).toBe('Weekend milk');
    expect((screen.getByLabelText('Product') as HTMLInputElement).value).toBe('Milk');
    fireEvent.change(screen.getByLabelText('Percent'), { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH' && c.url === '/promotions/pr1')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH' && c.url === '/promotions/pr1')!.body).toMatchObject({ name: 'Weekend milk', value: 15, productId: 'p1' });
  });

  it('asks before deleting, then deletes', async () => {
    renderApp(<Promotions />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url === '/promotions/pr1')).toBe(true));
  });
});
