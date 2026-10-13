import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json, renderApp, stubApi, stubBrowser } from '../test/utils';
import { Reports } from './Reports';

vi.mock('../lib/auth', () => ({ useAuth: () => ({ session: { user: { role: 'MANAGER' } }, can: () => true, canAny: () => true }) }));

const damaged = {
  title: 'Damaged stock',
  columns: [
    { key: 'createdAt', label: 'Date', type: 'date' }, { key: 'product', label: 'Product', type: 'text' }, { key: 'quantity', label: 'Quantity damaged', type: 'number' },
    { key: 'unitCost', label: 'Unit cost', type: 'money' }, { key: 'lossValue', label: 'Loss value', type: 'money' }, { key: 'branch', label: 'Branch', type: 'text' },
    { key: 'reason', label: 'Reason', type: 'text' }, { key: 'userName', label: 'Recorded by', type: 'text' },
  ],
  rows: [
    { id: '1', createdAt: '2026-10-01T10:00:00Z', product: 'Milk', quantity: 3, unitCost: 600, lossValue: 1800, branch: 'Main', reason: 'Dropped pallet', userName: 'Mary' },
    { id: '2', createdAt: '2026-10-02T10:00:00Z', product: 'Rice', quantity: 2, unitCost: 250, lossValue: 500, branch: 'Main', reason: 'Water leak', userName: 'Sam' },
  ],
};

let calls: ReturnType<typeof stubApi>;
beforeEach(() => {
  stubBrowser();
  calls = stubApi((url) => (url.startsWith('/reports/') ? json(url.startsWith('/reports/damaged-stock') ? damaged : { title: 'Sales', columns: [], rows: [] }) : undefined));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const reportCalls = () => calls.filter((c) => c.url.startsWith('/reports/damaged-stock'));
const params = (url: string) => new URLSearchParams(url.split('?')[1]);

describe('damaged stock report', () => {
  const open = async () => {
    renderApp(<Reports />);
    fireEvent.change(await screen.findByLabelText('Report'), { target: { value: 'damaged-stock' } });
    await screen.findByText('Dropped pallet');
  };

  it('is listed under Reports and shows every required column and a loss total', async () => {
    await open();
    for (const heading of ['Date', 'Product', 'Quantity damaged', 'Unit cost', 'Loss value', 'Branch', 'Reason', 'Recorded by']) {
      expect(screen.getByRole('columnheader', { name: heading }), heading).toBeTruthy();
    }
    expect(screen.getByText('Mary')).toBeTruthy();
    expect(screen.getByText(/Loss value total/).textContent).toMatch(/2,300/);
  });

  it('offers date, branch-ready and reason filters and sends them to the API', async () => {
    await open();
    expect(screen.getByLabelText('From')).toBeTruthy();
    expect(screen.getByLabelText('To')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Reason contains'), { target: { value: 'leak' } });
    await waitFor(() => expect(reportCalls().some((c) => params(c.url).get('reason') === 'leak')).toBe(true), { timeout: 2000 });
    expect(params(reportCalls()[0]!.url).get('from')).toBeTruthy();
  });

  it('does not show the reason filter on other reports', async () => {
    renderApp(<Reports />);
    await screen.findByLabelText('Report');
    expect(screen.queryByLabelText('Reason contains')).toBeNull();
  });

  it('prints (PDF) and exports to Excel using the current filters', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Excel' }));
    await waitFor(() => expect(reportCalls().some((c) => params(c.url).get('format') === 'xlsx')).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    await waitFor(() => expect(window.open).toHaveBeenCalled());
    expect(reportCalls().some((c) => params(c.url).get('format') === 'pdf')).toBe(true);
  });
});
