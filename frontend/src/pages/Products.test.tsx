import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json, page, renderApp, stubApi, stubBrowser } from '../test/utils';
import { Products } from './Products';

vi.mock('../lib/auth', () => ({ useAuth: () => ({ session: { user: { role: 'MANAGER' } }, can: () => true, canAny: () => true }) }));

const product = (id: string, name: string) => ({
  id, name, sku: `SKU-${id}`, brand: null, category: null, barcodes: [{ id: `b${id}`, code: `600${id}`, isPrimary: true, isInternal: false }],
  price: 1000, stock: 5, minStock: 1, unit: 'pcs', isActive: true,
});
const categories = [{ id: 'c1', name: 'Dairy', _count: { products: 2 } }, { id: 'c2', name: 'Empty', _count: { products: 0 } }];

let calls: ReturnType<typeof stubApi>;
beforeEach(() => {
  stubBrowser();
  calls = stubApi((url, { method }) => {
    if (url.startsWith('/products/labels.pdf')) return new Response('pdf');
    if (url.startsWith('/products')) return json(page([product('1', 'Milk'), product('2', 'Bread'), product('3', 'Rice')]));
    if (url === '/categories' && method === 'POST') return json({ id: 'c3', name: 'Frozen' }, 201);
    if (url.startsWith('/categories')) return json(page(categories));
    return undefined;
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const labelCall = () => calls.find((c) => c.url.startsWith('/products/labels.pdf'));
const ids = () => new URLSearchParams(labelCall()!.url.split('?')[1]).get('ids');

describe('product label selection', () => {
  it('selects individual products, all results and clears, showing the count', async () => {
    renderApp(<Products />);
    await screen.findByText('Milk');
    const print = screen.getByRole('button', { name: 'Print Selected Labels' });
    expect(print).toHaveProperty('disabled', true);
    expect(screen.getByText(/^0 selected/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Select Milk'));
    expect(screen.getByText(/^1 selected/)).toBeTruthy();
    expect(print).toHaveProperty('disabled', false);

    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getByText(/^3 selected/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Select Bread'));
    expect(screen.getByText(/^2 selected/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.getByText(/^0 selected/)).toBeTruthy();
    expect(print).toHaveProperty('disabled', true);
  });

  it('prints labels for the selected products only, while "this page" still prints every result', async () => {
    renderApp(<Products />);
    await screen.findByText('Milk');
    fireEvent.click(screen.getByLabelText('Select Milk'));
    fireEvent.click(screen.getByLabelText('Select Rice'));
    fireEvent.click(screen.getByRole('button', { name: 'Print Selected Labels' }));
    await waitFor(() => expect(labelCall()).toBeTruthy());
    expect(ids()).toBe('1,3');

    calls.length = 0;
    fireEvent.click(screen.getByRole('button', { name: 'Print labels (this page)' }));
    await waitFor(() => expect(labelCall()).toBeTruthy());
    expect(ids()).toBe('1,2,3');
  });

  it('does not open the product editor when a checkbox is ticked', async () => {
    renderApp(<Products />);
    await screen.findByText('Milk');
    fireEvent.click(screen.getByLabelText('Select Milk'));
    expect(screen.queryByText('Edit product')).toBeNull();
  });
});

describe('categories tab', () => {
  const openTab = async () => {
    const view = renderApp(<Products />);
    fireEvent.click((await screen.findAllByRole('tab', { name: 'Categories' }))[0]!);
    await screen.findByText('Dairy');
    return view;
  };

  it('lists categories with product counts and blocks deleting ones that are in use', async () => {
    await openTab();
    const row = (name: string) => screen.getByText(name).closest('tr')!;
    expect(row('Dairy').textContent).toContain('2');
    const deleteIn = (name: string) => row(name).querySelector<HTMLButtonElement>('button:last-of-type')!;
    expect(deleteIn('Dairy').disabled).toBe(true);
    expect(deleteIn('Dairy').title).toMatch(/reassign/i);
    expect(deleteIn('Empty').disabled).toBe(false);
  });

  it('adds a category and refreshes the product form dropdown source straight away', async () => {
    const { client } = await openTab();
    const refresh = vi.spyOn(client, 'invalidateQueries');
    fireEvent.click(screen.getByRole('button', { name: 'Add category' }));
    fireEvent.change(await screen.findByLabelText('Category name'), { target: { value: 'Frozen' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/categories')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ name: 'Frozen' });
    await waitFor(() => expect(refresh).toHaveBeenCalledWith({ queryKey: ['ref'] }));
  });

  it('shows the server message when a duplicate name is rejected', async () => {
    stubApi((url, { method }) => {
      if (url === '/categories' && method === 'POST') return json({ error: { message: 'A category named “Dairy” already exists' } }, 409);
      if (url.startsWith('/categories')) return json(page(categories));
      if (url.startsWith('/products')) return json(page([]));
      return undefined;
    });
    await openTab();
    fireEvent.click(screen.getByRole('button', { name: 'Add category' }));
    fireEvent.change(await screen.findByLabelText('Category name'), { target: { value: 'dairy' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/already exists/);
  });
});
