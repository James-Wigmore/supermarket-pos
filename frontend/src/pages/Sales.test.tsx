import 'fake-indexeddb/auto';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json, page, renderApp, stubApi } from '../test/utils';
import { Sales } from './Sales';

const perms = vi.hoisted(() => ({ readAll: true }));
vi.mock('../lib/auth', () => ({ useAuth: () => ({ session: { user: { role: 'MANAGER' } }, can: () => perms.readAll, canAny: () => true }) }));
vi.mock('../lib/sync', () => ({ useSync: () => ({ online: true, syncNow: vi.fn() }) }));

const sale = { id: 's1', receiptNo: 'RCT-1', soldAt: '2026-10-01T10:00:00Z', total: 5000, status: 'COMPLETED', offline: false, cashierName: 'Charles', payments: [{ method: 'CASH', amount: 5000 }], items: [] };
const refund = { id: 'r1', number: 'RTN-1', createdAt: '2026-10-02T09:00:00Z', method: 'MOBILE_MONEY', refundAmount: 1500, reason: 'Damaged packaging', sale: { receiptNo: 'RCT-1' } };
let calls: ReturnType<typeof stubApi>;
beforeEach(() => {
  perms.readAll = true;
  calls = stubApi((url) => (url.startsWith('/returns') ? json(page([refund])) : url.startsWith('/sales') ? json(page([sale])) : undefined));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('refunds list', () => {
  it('shows refunds on their own tab with receipt, method, reason and amount', async () => {
    renderApp(<Sales />);
    await screen.findByText('RCT-1');
    expect(calls.some((c) => c.url.startsWith('/returns'))).toBe(false);
    fireEvent.click(screen.getByRole('tab', { name: 'Refunds' }));
    expect(await screen.findByText('RTN-1')).toBeTruthy();
    expect(screen.getByText('Damaged packaging')).toBeTruthy();
    expect(screen.getByText('Mobile money')).toBeTruthy();
    expect(screen.getByText(/1,500/)).toBeTruthy();
  });

  it('is hidden from users who may not read all sales', async () => {
    perms.readAll = false;
    renderApp(<Sales />);
    await screen.findByText('RCT-1');
    expect(screen.queryByRole('tab', { name: 'Refunds' })).toBeNull();
  });
});
