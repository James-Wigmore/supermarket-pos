import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Badge, Button, Confirm, DataTable, ErrorNote, Input, Modal, PageHeader, Pagination, Panel, Tabs, inputCls, useToast } from '../components/ui';
import { Categories } from './Categories';
import { ReferenceSelect } from '../components/ReferenceSelect';
import { ApiError, api, downloadFile } from '../lib/api';
import { useAuth } from '../lib/auth';
import { date, fmtNum, money, num, currencyCode } from '../lib/format';
import { errorMessage, useDebounced } from '../lib/hooks';
import { usePage, useRefList } from '../lib/queries';
import type { LookupResult, Named, Product } from '../lib/types';

interface FormState {
  name: string; brand: string; manufacturer: string; categoryId: string; supplierId: string; unit: string; packageSize: string; imageUrl: string;
  purchasePrice: string; sellingPrice: string; taxRate: string; minStock: string; maxStock: string; tracksExpiry: boolean; barcode: string; generateBarcode: boolean;
}

const EMPTY: FormState = {
  name: '', brand: '', manufacturer: '', categoryId: '', supplierId: '', unit: 'pcs', packageSize: '', imageUrl: '', purchasePrice: '', sellingPrice: '',
  taxRate: '0', minStock: '0', maxStock: '', tracksExpiry: false, barcode: '', generateBarcode: false,
};

const fromProduct = (p: Product): FormState => ({
  ...EMPTY, name: p.name, brand: p.brand ?? '', manufacturer: p.manufacturer ?? '', categoryId: p.categoryId ?? '', supplierId: p.supplierId ?? '', unit: p.unit,
  packageSize: p.packageSize ?? '', imageUrl: p.imageUrl ?? '', purchasePrice: String(num(p.purchasePrice)), sellingPrice: String(num(p.price)), taxRate: String(num(p.taxRate)),
  minStock: String(num(p.minStock)), maxStock: p.maxStock == null ? '' : String(num(p.maxStock)), tracksExpiry: p.tracksExpiry,
});

const clean = <T extends object>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v !== undefined)) as Partial<T>;

const ProductForm = ({ product, onClose }: { product: Product | null; onClose: () => void }) => {
  const client = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const categories = useRefList<Named>('/categories');
  const suppliers = useRefList<Named>('/suppliers', true, { isActive: true });
  const [f, setF] = useState<FormState>(product ? fromProduct(product) : EMPTY);
  const [note, setNote] = useState('');
  const [looking, setLooking] = useState(false);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setF((s) => ({ ...s, [key]: value }));

  const lookup = async () => {
    const code = f.barcode.trim();
    if (!code) return;

    setLooking(true);
    setNote('');

    try {
      const r = await api<LookupResult>(
        `/products/lookup/${encodeURIComponent(code)}`,
        { query: { external: true } }
      );

      if (r.source === 'internal') {
        setNote(
          `This barcode already belongs to “${r.product.name}”. Open that product instead of creating a duplicate.`
        );
      } else if (r.source === 'external') {
        const s = r.suggestion;

        setF((cur) => ({
          ...cur,
          name: cur.name || s.name,
          brand: cur.brand || (s.brand ?? ''),
          manufacturer: cur.manufacturer || (s.manufacturer ?? ''),
          packageSize: cur.packageSize || (s.packageSize ?? ''),
          imageUrl: cur.imageUrl || (s.imageUrl ?? ''),
          categoryId:
            cur.categoryId ||
            (categories.data?.find(
              (c) => c.name.toLowerCase() === s.category?.toLowerCase()
            )?.id ?? ''),
        }));

        setNote(
          'Product details were found online. Review them, then set your own prices, tax and stock levels before saving.'
        );
      } else {
        setNote(
          r.lookupFailed
            ? 'The online product service could not be reached. Enter the details manually.'
            : 'No online details found. Enter the details manually.'
        );
      }
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Lookup failed');
    } finally {
      setLooking(false);
    }
  };

  const save = useMutation({
    mutationFn: () => {
      const shared = {
        name: f.name.trim(),
        brand: f.brand,
        manufacturer: f.manufacturer,
        unit: f.unit,
        packageSize: f.packageSize,
        imageUrl: f.imageUrl,
        purchasePrice: Number(f.purchasePrice || 0),
        taxRate: Number(f.taxRate || 0),
        minStock: Number(f.minStock || 0),
        tracksExpiry: f.tracksExpiry,
        categoryId: f.categoryId || null,
        supplierId: f.supplierId || null,
        maxStock: f.maxStock === '' ? null : Number(f.maxStock),
      };

      if (product) {
        return api(`/products/${product.id}`, {
          method: 'PATCH',
          body: clean(shared),
        });
      }

      return api('/products', {
        method: 'POST',
        body: {
          ...clean(shared),
          categoryId: shared.categoryId,
          supplierId: shared.supplierId,
          sellingPrice: Number(f.sellingPrice),
          barcodes: f.barcode ? [f.barcode.trim()] : [],
          generateBarcode: f.generateBarcode,
        },
      });
    },

    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['products'] });
      toast('success', product ? 'Product updated' : 'Product created');
      onClose();
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={product ? 'Edit product' : 'New product'}
      width="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            loading={save.isPending}
            disabled={!f.name || (!product && !f.sellingPrice)}
          >
            Save product
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        {!product && (
          <div className="sm:col-span-2">
            <label htmlFor="bc" className="mb-1 block text-sm font-medium">
              Barcode
            </label>

            <div className="flex gap-2">
              <input
                id="bc"
                className={inputCls}
                value={f.barcode}
                placeholder="Scan the manufacturer barcode"
                autoFocus
                onChange={(e) => set('barcode', e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void lookup();
                  }
                }}
              />

              <Button
                variant="secondary"
                onClick={() => void lookup()}
                loading={looking}
                disabled={!f.barcode}
              >
                Find details
              </Button>
            </div>

            <label className="mt-2 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={f.generateBarcode}
                onChange={(e) => set('generateBarcode', e.target.checked)}
              />
              No manufacturer barcode: generate an internal one
            </label>

            {note && (
              <p className="mt-2 rounded-field bg-brand-soft px-3 py-2 text-sm text-brand-dark">
                {note}
              </p>
            )}
          </div>
        )}

        <Input
          label="Name"
          value={f.name}
          onChange={(e) => set('name', e.target.value)}
          className="sm:col-span-2"
          required
        />

        <Input
          label="Brand"
          value={f.brand}
          onChange={(e) => set('brand', e.target.value)}
        />

        <Input
          label="Manufacturer"
          value={f.manufacturer}
          onChange={(e) => set('manufacturer', e.target.value)}
        />

        <ReferenceSelect
          label="Category"
          path="/categories"
          options={categories.data ?? []}
          value={f.categoryId}
          onChange={(value) => set('categoryId', value)}
          canAdd={can('product:write')}
        />

        <ReferenceSelect
          label="Supplier"
          path="/suppliers"
          options={suppliers.data ?? []}
          value={f.supplierId}
          onChange={(value) => set('supplierId', value)}
          canAdd={can('supplier:write')}
        />

        <Input
          label="Unit"
          value={f.unit}
          onChange={(e) => set('unit', e.target.value)}
          hint="pcs, kg, litre..."
        />

        <Input
          label="Package size"
          value={f.packageSize}
          onChange={(e) => set('packageSize', e.target.value)}
        />

        <Input
          label={`Purchase price (${currencyCode()})`}
          inputMode="decimal"
          value={f.purchasePrice}
          onChange={(e) => set('purchasePrice', e.target.value)}
        />

        {!product ? (
          <Input
            label={`Selling price (${currencyCode()})`}
            inputMode="decimal"
            value={f.sellingPrice}
            onChange={(e) => set('sellingPrice', e.target.value)}
            required
          />
        ) : (
          <Input
            label={`Selling price (${currencyCode()})`}
            value={f.sellingPrice}
            disabled
            hint={
              can('price:write')
                ? 'Change it from “Change price” so the history is kept.'
                : 'Only managers can change prices.'
            }
          />
        )}

        <Input
          label="Tax included in price (%)"
          inputMode="decimal"
          value={f.taxRate}
          onChange={(e) => set('taxRate', e.target.value)}
        />

        <Input
          label="Minimum stock"
          inputMode="decimal"
          value={f.minStock}
          onChange={(e) => set('minStock', e.target.value)}
        />

        <Input
          label="Maximum stock"
          inputMode="decimal"
          value={f.maxStock}
          onChange={(e) => set('maxStock', e.target.value)}
        />

        <Input
          label="Image URL"
          value={f.imageUrl}
          onChange={(e) => set('imageUrl', e.target.value)}
        />

        <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={f.tracksExpiry}
            onChange={(e) => set('tracksExpiry', e.target.checked)}
          />
          Track batches and expiry dates
        </label>

        <div className="sm:col-span-2">
          <ErrorNote error={save.error} />
        </div>

        <button type="submit" hidden />
      </form>

      {product && <Barcodes product={product} />}
    </Modal>
  );
};

const Barcodes = ({ product }: { product: Product }) => {
  const client = useQueryClient();
  const toast = useToast();
  const [code, setCode] = useState('');

  const refresh = () =>
    client.invalidateQueries({ queryKey: ['products'] });

  const add = useMutation({
    mutationFn: (body: string | null) =>
      body
        ? api(`/products/${product.id}/barcodes`, {
            method: 'POST',
            body: { code: body },
          })
        : api(`/products/${product.id}/barcodes/generate`, {
            method: 'POST',
          }),
    onSuccess: () => {
      setCode('');
      void refresh();
      toast('success', 'Barcode added');
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      api(`/products/${product.id}/barcodes/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => void refresh(),
  });

  return (
    <div className="mt-6 border-t border-line pt-4">
      <h3 className="mb-2 font-semibold">Barcodes</h3>

      <ul className="mb-3 space-y-1.5 text-sm">
        {product.barcodes.map((b) => (
          <li
            key={b.id}
            className="flex items-center justify-between rounded-field bg-paper px-3 py-1.5"
          >
            <span className="font-mono">
              {b.code}{' '}
              {b.isInternal && <Badge>Internal</Badge>}{' '}
              {b.isPrimary && <Badge tone="good">Primary</Badge>}
            </span>

            <button
              type="button"
              className="text-danger"
              onClick={() => remove.mutate(b.id)}
            >
              Remove
            </button>
          </li>
        ))}

        {!product.barcodes.length && (
          <li className="text-muted">No barcodes yet.</li>
        )}
      </ul>

      <div className="flex gap-2">
        <input
          aria-label="New barcode alias"
          className={inputCls}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Scan another barcode for this product"
        />

        <Button
          variant="secondary"
          onClick={() => add.mutate(code)}
          disabled={!code}
          loading={add.isPending}
        >
          Add
        </Button>

        <Button
          variant="secondary"
          onClick={() => add.mutate(null)}
        >
          Generate
        </Button>
      </div>

      <div className="mt-2">
        <ErrorNote error={add.error ?? remove.error} />
      </div>
    </div>
  );
};

const PriceModal = ({
  product,
  onClose,
}: {
  product: Product;
  onClose: () => void;
}) => {
  const client = useQueryClient();
  const toast = useToast();
  const [price, setPrice] = useState(String(num(product.price)));
  const [when, setWhen] = useState('');
  const [reason, setReason] = useState('');

  const history = useQuery({
    queryKey: ['price-history', product.id],
    queryFn: () =>
      api<
        {
          id: string;
          oldPrice: string | null;
          newPrice: string;
          effectiveFrom: string;
          reason: string | null;
        }[]
      >(`/products/${product.id}/prices`),
  });

  const save = useMutation({
    mutationFn: () =>
      api(`/products/${product.id}/prices`, {
        method: 'POST',
        body: {
          newPrice: Number(price),
          effectiveFrom: when
            ? new Date(when).toISOString()
            : undefined,
          reason: reason || undefined,
        },
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['products'] });
      void history.refetch();
      toast('success', when ? 'Price scheduled' : 'Price updated');
      setWhen('');
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Price: ${product.name}`}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label={`New price (${currencyCode()})`}
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />

        <Input
          label="Starts on (optional)"
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          hint="Leave empty to apply now"
        />

        <Input
          label="Reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="sm:col-span-2"
        />
      </div>

      <div className="mt-3 flex items-center gap-3">
        <Button
          onClick={() => save.mutate()}
          loading={save.isPending}
          disabled={!price}
        >
          {when ? 'Schedule price' : 'Update price'}
        </Button>

        <ErrorNote error={save.error} />
      </div>

      <h3 className="mb-1 mt-6 font-semibold">History</h3>

      <DataTable
        rowKey={(r) => r.id}
        rows={history.data}
        loading={history.isLoading}
        columns={[
          {
            header: 'Effective',
            cell: (r) => (
              <>
                {date(r.effectiveFrom)}{' '}
                {new Date(r.effectiveFrom) > new Date() && (
                  <Badge tone="warn">Scheduled</Badge>
                )}
              </>
            ),
          },
          {
            header: 'Old',
            cell: (r) => (r.oldPrice ? money(r.oldPrice) : '—'),
            align: 'right',
          },
          {
            header: 'New',
            cell: (r) => money(r.newPrice),
            align: 'right',
          },
          {
            header: 'Reason',
            cell: (r) => r.reason ?? '—',
          },
        ]}
      />
    </Modal>
  );
};

const MAX_LABELS = 100; // the label sheet accepts at most 100 products per print

const ProductList = ({ tabs }: { tabs: ReactNode }) => {
  const { can } = useAuth();
  const toast = useToast();
  const client = useQueryClient();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Product | null | 'new'>(null);
  const [pricing, setPricing] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState<Product | null>(null);

  const q = useDebounced(search);
  const list = usePage<Product>('products', '/products', { search: q, page, pageSize: 25 });
  const rows = list.data?.data ?? [];

  const toggle = (id: string) => setSelected((cur) => { const next = new Set(cur); if (!next.delete(id)) next.add(id); return next; });
  const printLabels = (ids: string[]) => void downloadFile('/products/labels.pdf', { ids: ids.join(',') }, 'labels.pdf').catch((err) => toast('error', errorMessage(err)));

  const del = useMutation({
    mutationFn: (id: string) =>
      api<{ deleted: boolean }>(`/products/${id}`, {
        method: 'DELETE',
      }),

    onSuccess: (r) => {
      toast(
        'success',
        r.deleted
          ? 'Product deleted'
          : 'Product has history, so it was deactivated instead'
      );

      setDeleting(null);
      void client.invalidateQueries({ queryKey: ['products'] });
    },

    onError: (e) =>
      toast(
        'error',
        e instanceof ApiError ? e.message : 'Delete failed'
      ),
  });

  return (
    <>
      <PageHeader title="Products" subtitle="Catalogue, barcodes and prices">
        <input aria-label="Search products" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search name, SKU, barcode" className={`${inputCls} !w-64`} />
        <Button variant="secondary" onClick={() => printLabels(rows.map((p) => p.id))} disabled={!rows.length}>Print labels (this page)</Button>
        {can('product:write') && <Button onClick={() => setEditing('new')}>New product</Button>}
      </PageHeader>
      {tabs}
      <Panel className="!p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 text-sm">
          <Button size="sm" variant="secondary" onClick={() => setSelected((cur) => new Set([...cur, ...rows.map((p) => p.id)]))} disabled={!rows.length}>Select all</Button>
          <Button size="sm" variant="secondary" onClick={() => setSelected(new Set())} disabled={!selected.size}>Clear selection</Button>
          <span className="text-muted" aria-live="polite">
            {selected.size} selected{selected.size > MAX_LABELS && ` (print up to ${MAX_LABELS} at a time)`}
            {(list.data?.meta.totalPages ?? 1) > 1 && ' · Select all covers this page of results'}
          </span>
          <Button size="sm" className="ml-auto" onClick={() => printLabels([...selected])} disabled={!selected.size || selected.size > MAX_LABELS}>Print Selected Labels</Button>
        </div>
        <DataTable rowKey={(p) => p.id} rows={rows} loading={list.isLoading} onRowClick={(p) => can('product:write') && setEditing(p)}
          empty={<p className="p-10 text-center text-muted">No products match. {can('product:write') && 'Create one or scan a barcode in Receiving.'}</p>}
          columns={[
            { header: 'Select', cell: (p) => <input type="checkbox" className="size-4 accent-brand" checked={selected.has(p.id)} onChange={() => toggle(p.id)} onClick={(e) => e.stopPropagation()} aria-label={`Select ${p.name}`} /> },
            { header: 'Product', cell: (p) => <><div className="font-semibold">{p.name}</div><div className="text-xs text-muted">{[p.brand, p.category?.name, p.sku].filter(Boolean).join(' · ')}</div></> },
            { header: 'Barcode', cell: (p) => <span className="font-mono text-xs">{p.barcodes[0]?.code ?? '—'}</span> },
            { header: 'Price', cell: (p) => (p.price ? money(p.price) : '—'), align: 'right' },
            { header: 'Stock', cell: (p) => <span className={num(p.stock) <= 0 ? 'font-semibold text-danger' : num(p.stock) <= num(p.minStock) ? 'font-semibold text-warn' : ''}>{fmtNum(p.stock)} {p.unit}</span>, align: 'right' },
            { header: 'Status', cell: (p) => (p.isActive ? <Badge tone="good">Active</Badge> : <Badge>Inactive</Badge>) },
            { header: '', cell: (p) => (
              <span className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                {can('price:write') && <Button size="sm" variant="secondary" onClick={() => setPricing(p)}>Change price</Button>}
                {can('product:delete') && <Button size="sm" variant="ghost" onClick={() => setDeleting(p)}>Delete</Button>}
              </span>) },
          ]} />
        <Pagination meta={list.data?.meta} onPage={setPage} />
      </Panel>

      {editing && (
        <ProductForm
          product={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}

      {pricing && (
        <PriceModal
          product={pricing}
          onClose={() => setPricing(null)}
        />
      )}

      <Confirm
        open={Boolean(deleting)}
        danger
        title="Delete product?"
        message={`“${deleting?.name}” will be removed. If it already has sales or stock history it is deactivated instead, so records stay intact.`}
        confirmLabel="Delete"
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && del.mutate(deleting.id)}
        loading={del.isPending}
      />
    </>
  );
};

/** Both tabs stay mounted so a label selection survives a visit to Categories. */
export const Products = () => {
  const [tab, setTab] = useState<'products' | 'categories'>('products');
  const tabs = <Tabs value={tab} onChange={setTab} tabs={[{ id: 'products', label: 'Products' }, { id: 'categories', label: 'Categories' }]} />;
  return (
    <>
      <div hidden={tab !== 'products'}><ProductList tabs={tabs} /></div>
      <div hidden={tab !== 'categories'}><Categories tabs={tabs} /></div>
    </>
  );
};
