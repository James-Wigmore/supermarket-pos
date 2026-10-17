import { cleanup, fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Customer } from '../../lib/types';
import { json, page, renderApp, stubApi } from '../../test/utils';
import { CustomerPicker } from './CustomerPicker';

const ann: Customer = { id: 'c1', name: 'Ann Nakato', phone: '0700111222', email: null, loyaltyPoints: 12 };
let calls: ReturnType<typeof stubApi>;
beforeEach(() => { calls = stubApi((url) => (url.startsWith('/customers') ? json(page(url.includes('search=zzz') ? [] : [ann])) : undefined)); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const Harness = ({ online = true, onPick }: { online?: boolean; onPick?: (c: Customer | null) => void }) => {
  const [customer, setCustomer] = useState<Customer | null>(null);
  return <CustomerPicker customer={customer} online={online} onChange={(c) => { setCustomer(c); onPick?.(c); }} />;
};

describe('customer on the till', () => {
  it('finds a customer by name or phone, attaches them, shows their points and can remove them', async () => {
    const onPick = vi.fn();
    renderApp(<Harness onPick={onPick} />);
    fireEvent.change(screen.getByLabelText('Customer (optional)'), { target: { value: 'ann' } });
    fireEvent.click(await screen.findByRole('button', { name: /Ann Nakato/ }, { timeout: 2000 }));
    expect(onPick).toHaveBeenLastCalledWith(ann);
    expect(screen.getByText(/12 pts/)).toBeTruthy();
    expect(calls.some((c) => c.url.includes('search=ann'))).toBe(true);
    fireEvent.click(screen.getByLabelText('Remove customer'));
    expect(onPick).toHaveBeenLastCalledWith(null);
    expect(screen.getByLabelText('Customer (optional)')).toBeTruthy();
  });

  it('says so when nobody matches, and never searches for a single character', async () => {
    renderApp(<Harness />);
    const input = screen.getByLabelText('Customer (optional)');
    fireEvent.change(input, { target: { value: 'a' } });
    await new Promise((r) => setTimeout(r, 400));
    expect(calls).toHaveLength(0);
    fireEvent.change(input, { target: { value: 'zzz' } });
    expect(await screen.findByText('No customer found', undefined, { timeout: 2000 })).toBeTruthy();
  });

  it('is disabled with an explanation while offline', () => {
    renderApp(<Harness online={false} />);
    const input = screen.getByLabelText('Customer (optional)') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(input.placeholder).toMatch(/needs a connection/i);
  });
});
