import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json, page, renderApp, stubApi, stubBrowser } from '../test/utils';
import { Shifts } from './Shifts';

const sync = vi.hoisted(() => ({ pending: 0, failed: 0 }));
vi.mock('../lib/auth', () => ({ useAuth: () => ({ can: () => false, canAny: () => true }) }));
vi.mock('../lib/sync', () => ({ useSync: () => ({ ...sync, syncing: false, syncNow: vi.fn() }) }));

const session = { id: 'sh1', registerId: 'r1', branchId: 'b1', cashierId: 'u1', status: 'OPEN', openingCash: 10000, expectedCash: null, actualCash: null, difference: null, openedAt: new Date().toISOString(), closedAt: null, register: { name: 'Register 1' } };
const summary = { session, salesCount: 2, salesTotal: '5000', discounts: '0', cashSales: '5000', mobileMoney: '0', card: '0', other: '0', refunds: '0', cashRefunds: '0', voidsCount: 0, voidsTotal: '0', expectedCash: '15000' };

beforeEach(() => {
  stubBrowser();
  sync.pending = 0; sync.failed = 0;
  stubApi((url) => {
    if (url === '/sessions/current') return json(session);
    if (url === '/sessions/sh1/summary') return json(summary);
    if (url.startsWith('/sessions')) return json(page([]));
    return undefined;
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const open = () => renderApp(<MemoryRouter><Shifts /></MemoryRouter>);

describe('closing a shift', () => {
  it('shows the expected drawer total (opening + shift cash) already filled in', async () => {
    open();
    const total = await screen.findByTestId('expected-total');
    await waitFor(() => expect(total.textContent).toMatch(/15,000/));
    expect(screen.getByText(/Opening .*10,000.* \+ cash from this shift .*5,000/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Close shift' }) as HTMLButtonElement).disabled).toBe(true); // nothing counted yet
    fireEvent.change(screen.getByLabelText(/Total counted in the drawer/), { target: { value: '15000' } });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Close shift' }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('blocks closing while offline sales are still waiting to upload', async () => {
    sync.pending = 2;
    open();
    await screen.findByText(/2 offline sales have not reached the server/);
    fireEvent.change(screen.getByLabelText(/Total counted in the drawer/), { target: { value: '15000' } });
    expect((screen.getByRole('button', { name: 'Close shift' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
