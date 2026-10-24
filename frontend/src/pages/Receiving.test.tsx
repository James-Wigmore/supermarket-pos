import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json, page, renderApp, stubApi, stubBrowser } from '../test/utils';
import { Receiving } from './Receiving';

const who = vi.hoisted(() => ({ role: 'SUPER_ADMIN' }));
vi.mock('../lib/auth', () => ({ useAuth: () => ({ session: { user: { role: who.role } }, can: () => true, canAny: () => true }) }));

const MAIN = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const KOLOLO = '9b2c1d7e-3f4a-4b5c-8d6e-1a2b3c4d5e6f';
const branch = (id: string, name: string, isActive = true) => ({ id, name, code: name.slice(0, 3).toUpperCase(), address: null, phone: null, isActive });
const milk = { id: 'p1', name: 'Milk', unit: 'pcs', stock: 5, price: 1000, purchasePrice: 600, supplierPrice: null, supplier: null, tracksExpiry: false, barcodes: [{ id: 'b', code: '6001', isPrimary: true, isInternal: false }] };

let branches = [branch(MAIN, 'Main Branch'), branch(KOLOLO, 'Kololo')];
let suppliers = [{ id: 's1', name: 'Acme', isActive: true }];
let calls: ReturnType<typeof stubApi>;
beforeEach(() => {
  stubBrowser();
  branches = [branch(MAIN, 'Main Branch'), branch(KOLOLO, 'Kololo')];
  suppliers = [{ id: 's1', name: 'Acme', isActive: true }];
  calls = stubApi((url, { method }) => {
    if (url === '/branches') return json(branches);
    if (url === '/suppliers' && method === 'POST') {
      const created = { id: 's2', name: 'New Supplier', isActive: true };
      suppliers.push(created);
      return json(created, 201);
    }
    if (url.startsWith('/suppliers')) return json(page(suppliers));
    if (url.startsWith('/products/lookup/')) return json({ source: 'internal', product: milk });
    if (url === '/purchases/deliveries' && method === 'POST') return json({ id: 'po1' }, 201);
    return undefined;
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const scan = () => screen.getByLabelText('Scan barcode') as HTMLInputElement;
const chooseSupplier = async () => {
  await screen.findByRole('option', { name: 'Acme' }); // the list loads asynchronously
  fireEvent.change(screen.getByLabelText('Supplier'), { target: { value: 's1' } });
};
const receiveOneItem = async () => {
  fireEvent.change(scan(), { target: { value: '6001' } });
  fireEvent.keyDown(scan(), { key: 'Enter' });
  fireEvent.change(await screen.findByLabelText('Quantity'), { target: { value: '12' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add to delivery' }));
  fireEvent.click(screen.getByRole('button', { name: 'Review and confirm' }));
};
const confirmDelivery = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm and update stock' }));
  await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/purchases/deliveries')).toBe(true));
  return calls.find((c) => c.method === 'POST' && c.url === '/purchases/deliveries')!;
};

describe('receiving as a super admin (no branch of their own)', () => {
  beforeEach(() => { who.role = 'SUPER_ADMIN'; });

  it('asks for a branch by name, never by ID, and blocks scanning until one is chosen', async () => {
    const { container } = renderApp(<Receiving />);
    const select = (await screen.findByLabelText('Branch')) as HTMLSelectElement;
    await screen.findByRole('option', { name: 'Kololo' });
    expect([...select.options].map((o) => o.textContent)).toEqual(['Select branch…', 'Main Branch', 'Kololo']);
    expect(container.textContent).not.toContain(KOLOLO);
    expect(container.textContent).not.toContain(MAIN);

    await chooseSupplier();
    expect(scan().disabled).toBe(true);
    expect(scan().placeholder).toMatch(/branch/i);
    fireEvent.change(select, { target: { value: KOLOLO } });
    expect(scan().disabled).toBe(false);
  });

  it('submits the selected branch ID with the delivery and shows the branch name in the review', async () => {
    renderApp(<Receiving />);
    await screen.findByRole('option', { name: 'Kololo' });
    fireEvent.change(screen.getByLabelText('Branch'), { target: { value: KOLOLO } });
    await chooseSupplier();
    await receiveOneItem();
    expect((await screen.findByText(/Kololo · Acme/)).textContent).toContain('1 products');

    const post = await confirmDelivery();
    expect(post.body).toMatchObject({ branchId: KOLOLO, supplierId: 's1' });
    expect(calls.find((c) => c.url.startsWith('/products/lookup/'))!.url).toContain(`branchId=${KOLOLO}`);
  });

  it('preselects the branch when the store has only one active branch', async () => {
    branches = [branch(MAIN, 'Main Branch'), branch(KOLOLO, 'Closed', false)];
    renderApp(<Receiving />);
    await waitFor(() => expect((screen.getByLabelText('Branch') as HTMLSelectElement).value).toBe(MAIN));
    await chooseSupplier();
    expect(scan().disabled).toBe(false);
  });

  it('adds a supplier manually from the supplier dropdown and selects it', async () => {
    renderApp(<Receiving />);
    await screen.findByRole('option', { name: 'Acme' });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.change(await screen.findByLabelText('Supplier name'), { target: { value: 'New Supplier' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(calls.some((call) => call.method === 'POST' && call.url === '/suppliers')).toBe(true));
    expect((screen.getByLabelText('Supplier') as HTMLSelectElement).value).toBe('s2');
  });
});

describe('supplier payment on a delivery', () => {
  beforeEach(() => { who.role = 'MANAGER'; });

  it('sends paid: true only when the user confirms the supplier has been paid', async () => {
    renderApp(<Receiving />);
    await chooseSupplier();
    fireEvent.click(screen.getByLabelText('Supplier paid'));
    await receiveOneItem();
    expect((await confirmDelivery()).body).toMatchObject({ supplierId: 's1', paid: true });
  });

  it('defaults to not paid and omits the flag', async () => {
    renderApp(<Receiving />);
    await chooseSupplier();
    await receiveOneItem();
    expect((await confirmDelivery()).body).not.toHaveProperty('paid');
  });
});

describe('receiving as a branch user', () => {
  beforeEach(() => { who.role = 'STOCK_OFFICER'; });

  it('shows no branch picker and submits no branch (the server uses their own)', async () => {
    renderApp(<Receiving />);
    await chooseSupplier();
    expect(screen.queryByLabelText('Branch')).toBeNull();
    expect(scan().disabled).toBe(false);
    await receiveOneItem();
    const post = await confirmDelivery();
    expect(post.body).not.toHaveProperty('branchId');
    expect(calls.some((c) => c.url === '/branches')).toBe(false);
  });
});


