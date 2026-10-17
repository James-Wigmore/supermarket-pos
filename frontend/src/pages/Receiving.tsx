import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { BranchField } from '../components/BranchField';
import { ReferenceSelect } from '../components/ReferenceSelect';
import { Badge, Button, DataTable, ErrorNote, Input, Modal, PageHeader, Panel, useToast } from '../components/ui';
import { api } from '../lib/api';
import { fmtNum, money, num, uuid, currencyCode } from '../lib/format';
import { errorMessage } from '../lib/hooks';
import { useBranchChoice, useRefList } from '../lib/queries';
import { useAuth } from '../lib/auth';
import type { LookupProduct, LookupResult, Named, Product, Suggestion } from '../lib/types';

interface Line { key: string; productId: string; name: string; unit: string; quantity: number; unitCost: number; batchNo: string; expiryDate: string; tracksExpiry: boolean }

interface Pending { product: LookupProduct; quantity: string; unitCost: string; batchNo: string; expiryDate: string }

const NewProductModal = ({ barcode, suggestion, supplierId, onClose, onCreated }: { barcode: string; suggestion?: Suggestion; supplierId: string; onClose: () => void; onCreated: (p: Product) => void }) => {
  const [f, setF] = useState({ name: suggestion?.name ?? '', brand: suggestion?.brand ?? '', packageSize: suggestion?.packageSize ?? '', sellingPrice: '', purchasePrice: '', tracksExpiry: false });
  const create = useMutation({
    mutationFn: () => api<Product>('/products', { method: 'POST', body: { name: f.name, brand: f.brand || undefined, manufacturer: suggestion?.manufacturer, packageSize: f.packageSize || undefined, imageUrl: suggestion?.imageUrl, sellingPrice: Number(f.sellingPrice), purchasePrice: Number(f.purchasePrice || 0), tracksExpiry: f.tracksExpiry, supplierId: supplierId || undefined, barcodes: [barcode] } }),
    onSuccess: onCreated,
  });
  return (
    <Modal open onClose={onClose} title="New product" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => create.mutate()} loading={create.isPending} disabled={!f.name || !f.sellingPrice}>Confirm and save</Button></>}>
      <p className="mb-3 rounded-field bg-brand-soft px-3 py-2 text-sm text-brand-dark">
        {suggestion ? 'Details came from an online product database. Check them and set your own prices.' : 'This barcode is not in the catalogue and no online details were found. Enter them manually.'}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Barcode" value={barcode} disabled />
        <Input label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
        <Input label="Brand" value={f.brand} onChange={(e) => setF({ ...f, brand: e.target.value })} />
        <Input label="Package size" value={f.packageSize} onChange={(e) => setF({ ...f, packageSize: e.target.value })} />
        <Input label={`Purchase price (${currencyCode()})`} inputMode="decimal" value={f.purchasePrice} onChange={(e) => setF({ ...f, purchasePrice: e.target.value })} />
        <Input label={`Selling price (${currencyCode()})`} inputMode="decimal" value={f.sellingPrice} onChange={(e) => setF({ ...f, sellingPrice: e.target.value })} />
        <label className="flex items-center gap-2 text-sm font-medium sm:col-span-2"><input type="checkbox" checked={f.tracksExpiry} onChange={(e) => setF({ ...f, tracksExpiry: e.target.checked })} /> Track batches and expiry dates</label>
      </div>
      <div className="mt-3"><ErrorNote error={create.error} /></div>
    </Modal>
  );
};

export const Receiving = () => {
  const { can } = useAuth();
  const toast = useToast();
  const client = useQueryClient();
  const suppliers = useRefList<Named>('/suppliers', true, { isActive: true });
  const branch = useBranchChoice();
  const [supplierId, setSupplierId] = useState('');
  const [scan, setScan] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [unknown, setUnknown] = useState<{ barcode: string; suggestion?: Suggestion } | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const clientRef = useRef(uuid()); // a repeated confirm must not receive the same delivery twice
  const scanRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const focusScan = () => setTimeout(() => scanRef.current?.focus(), 0);

  const beginLine = (product: LookupProduct) => {
    setPending({ product, quantity: '', unitCost: String(num(product.supplierPrice ?? product.purchasePrice)), batchNo: '', expiryDate: '' });
    setTimeout(() => qtyRef.current?.focus(), 0);
  };

  const lookup = async () => {
    const code = scan.trim();
    if (!code) return;
    try {
      const r = await api<LookupResult>(`/products/lookup/${encodeURIComponent(code)}`, { query: { external: true, supplierId: supplierId || undefined, branchId: branch.branchId || undefined } });
      setScan('');
      if (r.source === 'internal') beginLine(r.product);
      else setUnknown({ barcode: code, suggestion: r.source === 'external' ? r.suggestion : undefined });
    } catch (err) { toast('error', errorMessage(err)); }
  };

  const addLine = () => {
    if (!pending) return;
    const { product: p } = pending;
    const quantity = Number(pending.quantity);
    if (!(quantity > 0)) return;
    if (p.tracksExpiry && !pending.expiryDate) return toast('error', 'Enter the expiry date for this product.');
    const line: Line = { key: `${p.id}|${pending.batchNo}|${pending.expiryDate}`, productId: p.id, name: p.name, unit: p.unit, quantity, unitCost: Number(pending.unitCost || 0), batchNo: pending.batchNo, expiryDate: pending.expiryDate, tracksExpiry: p.tracksExpiry };
    setLines((l) => (l.some((x) => x.key === line.key) ? l.map((x) => (x.key === line.key ? { ...x, quantity: x.quantity + quantity, unitCost: line.unitCost } : x)) : [...l, line]));
    setPending(null);
    focusScan();
  };

  const confirm = useMutation({
    mutationFn: () => api('/purchases/deliveries', { method: 'POST', body: { clientRef: clientRef.current, supplierId, branchId: branch.branchId || undefined, items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitCost: l.unitCost, batchNo: l.batchNo || undefined, expiryDate: l.expiryDate ? new Date(l.expiryDate).toISOString() : undefined })) } }),
    onSuccess: () => { toast('success', `Delivery received: ${lines.length} products added to stock`); setLines([]); setReviewing(false); clientRef.current = uuid(); void client.invalidateQueries(); focusScan(); },
  });

  const total = lines.reduce((s, l) => s + l.quantity * l.unitCost, 0);
  const p = pending?.product;

  return (
    <>
      <PageHeader title="Receiving mode" subtitle="Scan, enter quantity, scan the next item. Stock updates only after you confirm the delivery." />
      <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
        <Panel>
          <div className="space-y-4">
            <BranchField choice={branch} />
            <ReferenceSelect label="Supplier" path="/suppliers" options={suppliers.data ?? []} value={supplierId} onChange={setSupplierId} canAdd={can('supplier:write')} emptyLabel="Select supplier…" />
            <Input ref={scanRef} label="Scan barcode" value={scan} autoFocus disabled={!supplierId || branch.missing} onChange={(e) => setScan(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void lookup(); } }} placeholder={branch.missing ? 'Choose a branch first' : supplierId ? 'Scan next item' : 'Choose a supplier first'} />
            {p && pending && (
              <form onSubmit={(e) => { e.preventDefault(); addLine(); }} className="space-y-3 rounded-panel border-2 border-brand bg-brand-soft/40 p-4">
                <div>
                  <p className="text-lg font-bold">{p.name}</p>
                  <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-sm text-muted">
                    <dt>In stock</dt><dd className="text-right font-medium text-ink">{fmtNum(p.stock)} {p.unit}</dd>
                    <dt>Last purchase price</dt><dd className="text-right font-medium text-ink">{money(p.supplierPrice ?? p.purchasePrice)}</dd>
                    <dt>Selling price</dt><dd className="text-right font-medium text-ink">{money(p.price)}</dd>
                    <dt>Supplier</dt><dd className="text-right font-medium text-ink">{p.supplier?.name ?? '—'}</dd>
                  </dl>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Input ref={qtyRef} label="Quantity" inputMode="decimal" value={pending.quantity} onChange={(e) => setPending({ ...pending, quantity: e.target.value })} />
                  <Input label="Unit cost" inputMode="decimal" value={pending.unitCost} onChange={(e) => setPending({ ...pending, unitCost: e.target.value })} />
                  {p.tracksExpiry && <><Input label="Batch no." value={pending.batchNo} onChange={(e) => setPending({ ...pending, batchNo: e.target.value })} /><Input label="Expiry date" type="date" value={pending.expiryDate} onChange={(e) => setPending({ ...pending, expiryDate: e.target.value })} /></>}
                </div>
                <div className="flex gap-2"><Button type="submit" disabled={!(Number(pending.quantity) > 0)}>Add to delivery</Button><Button variant="ghost" onClick={() => { setPending(null); focusScan(); }}>Skip</Button></div>
              </form>
            )}
          </div>
        </Panel>

        <Panel title={`Delivery (${lines.length} products)`} actions={<Button onClick={() => setReviewing(true)} disabled={!lines.length || branch.missing}>Review and confirm</Button>} className="min-w-0">
          <DataTable rowKey={(l) => l.key} rows={lines} empty={<p className="py-10 text-center text-muted">Nothing scanned yet. The delivery list builds up here.</p>}
            columns={[
              { header: 'Product', cell: (l) => <><div className="font-medium">{l.name}</div>{l.expiryDate && <div className="text-xs text-muted">Batch {l.batchNo || '—'} · expires {l.expiryDate}</div>}</> },
              { header: 'Qty', cell: (l) => `${fmtNum(l.quantity)} ${l.unit}`, align: 'right' },
              { header: 'Unit cost', cell: (l) => money(l.unitCost), align: 'right' },
              { header: 'Total', cell: (l) => <b>{money(l.quantity * l.unitCost)}</b>, align: 'right' },
              { header: '', cell: (l) => <button type="button" className="text-danger" onClick={() => setLines((x) => x.filter((y) => y.key !== l.key))}>Remove</button>, align: 'right' }]} />
        </Panel>
      </div>

      {unknown && <NewProductModal barcode={unknown.barcode} suggestion={unknown.suggestion} supplierId={supplierId} onClose={() => { setUnknown(null); focusScan(); }} onCreated={(created) => { setUnknown(null); void api<LookupResult>(`/products/lookup/${created.barcodes[0]?.code ?? ''}`, { query: { supplierId: supplierId || undefined, branchId: branch.branchId || undefined } }).then((r) => r.source === 'internal' && beginLine(r.product)); }} />}

      <Modal open={reviewing} onClose={() => setReviewing(false)} title="Confirm delivery" width="lg"
        footer={<><Button variant="secondary" onClick={() => setReviewing(false)}>Keep editing</Button><Button onClick={() => confirm.mutate()} loading={confirm.isPending}>Confirm and update stock</Button></>}>
        <p className="mb-3 text-sm text-muted">{branch.isAdmin && `${branch.name} · `}{suppliers.data?.find((s) => s.id === supplierId)?.name} · {lines.length} products · <b className="text-ink">{money(total)}</b>. Stock changes only when you confirm.</p>
        <DataTable rowKey={(l) => l.key} rows={lines} columns={[{ header: 'Product', cell: (l) => <>{l.name} {l.tracksExpiry && <Badge>Expiry {l.expiryDate}</Badge>}</> }, { header: 'Qty', cell: (l) => fmtNum(l.quantity), align: 'right' }, { header: 'Unit cost', cell: (l) => money(l.unitCost), align: 'right' }, { header: 'Total', cell: (l) => money(l.quantity * l.unitCost), align: 'right' }]} />
        <div className="mt-3"><ErrorNote error={confirm.error} /></div>
      </Modal>
    </>
  );
};
