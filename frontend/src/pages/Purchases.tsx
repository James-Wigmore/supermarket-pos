import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { BranchField } from '../components/BranchField';
import { ReferenceSelect } from '../components/ReferenceSelect';
import { Badge, Button, DataTable, ErrorNote, Input, Modal, PageHeader, Pagination, Panel, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { date, dateTime, fmtNum, label, money, num } from '../lib/format';
import { useDebounced } from '../lib/hooks';
import { useBranchChoice, usePage, useRefList } from '../lib/queries';
import type { Named, Product, Supplier } from '../lib/types';

interface PurchaseRow { id: string; number: string; status: 'ORDERED' | 'RECEIVED' | 'CANCELLED'; total: string; paymentStatus: 'PAID' | 'UNPAID'; createdAt: string; supplier: Named }
interface PurchaseItem { id: string; quantityOrdered: string; quantityReceived: string; unitCost: string; product: { name: string; unit: string; tracksExpiry: boolean } }
interface PurchaseDetail extends PurchaseRow { items: PurchaseItem[] }

const TONE = { ORDERED: 'warn', RECEIVED: 'good', CANCELLED: 'neutral' } as const;

const NewOrder = ({ onClose }: { onClose: () => void }) => {
  const { can } = useAuth();
  const client = useQueryClient();
  const toast = useToast();
  const suppliers = useRefList<Supplier>('/suppliers', true, { isActive: true });
  const branch = useBranchChoice();
  const [supplierId, setSupplierId] = useState('');
  const [search, setSearch] = useState('');
  const [lines, setLines] = useState<{ productId: string; name: string; quantity: string; unitCost: string }[]>([]);
  const q = useDebounced(search);
  const found = useQuery({ queryKey: ['po-search', q], queryFn: () => api<{ data: Product[] }>('/products', { query: { search: q, pageSize: 6, isActive: true } }), enabled: q.length >= 2 });
  const save = useMutation({
    mutationFn: () => api('/purchases', { method: 'POST', body: { supplierId, branchId: branch.branchId || undefined, items: lines.map((l) => ({ productId: l.productId, quantity: Number(l.quantity), unitCost: Number(l.unitCost) })) } }),
    onSuccess: () => { toast('success', 'Purchase order created'); void client.invalidateQueries({ queryKey: ['purchases'] }); onClose(); },
  });
  const valid = supplierId && !branch.missing && lines.length > 0 && lines.every((l) => Number(l.quantity) > 0 && l.unitCost !== '');
  const edit = (i: number, patch: Partial<(typeof lines)[number]>) => setLines((l) => l.map((x, n) => (n === i ? { ...x, ...patch } : x)));
  return (
    <Modal open onClose={onClose} title="New purchase order" width="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => save.mutate()} disabled={!valid} loading={save.isPending}>Create order</Button></>}>
      <div className="space-y-4">
        <BranchField choice={branch} />
        <ReferenceSelect label="Supplier" path="/suppliers" options={suppliers.data ?? []} value={supplierId} onChange={setSupplierId} canAdd={can('supplier:write')} emptyLabel="Select…" />
        <div className="relative">
          <Input label="Add product" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, SKU or barcode" />
          {found.data && search.length >= 2 && (
            <ul className="absolute z-10 mt-1 w-full rounded-panel border border-line bg-white shadow-lg">
              {found.data.data.map((p) => <li key={p.id}><button type="button" className="flex w-full justify-between px-3 py-2 text-left hover:bg-brand-soft" onClick={() => { setLines((l) => (l.some((x) => x.productId === p.id) ? l : [...l, { productId: p.id, name: p.name, quantity: '', unitCost: String(num(p.purchasePrice)) }])); setSearch(''); }}><span>{p.name}</span><span className="text-sm text-muted">cost {money(p.purchasePrice)}</span></button></li>)}
            </ul>
          )}
        </div>
        <DataTable rowKey={(l) => l.productId} rows={lines} empty={<p className="py-6 text-center text-sm text-muted">Search and add the products you want to order.</p>} columns={[
          { header: 'Product', cell: (l) => l.name },
          { header: 'Quantity', cell: (l) => <input aria-label={`Quantity ${l.name}`} className="w-24 rounded-field border border-line px-2 py-1" inputMode="decimal" value={l.quantity} onChange={(e) => edit(lines.indexOf(l), { quantity: e.target.value })} /> },
          { header: 'Unit cost', cell: (l) => <input aria-label={`Cost ${l.name}`} className="w-28 rounded-field border border-line px-2 py-1" inputMode="decimal" value={l.unitCost} onChange={(e) => edit(lines.indexOf(l), { unitCost: e.target.value })} /> },
          { header: 'Total', cell: (l) => money(num(l.quantity) * num(l.unitCost)), align: 'right' },
          { header: '', cell: (l) => <button type="button" className="text-danger" onClick={() => setLines((x) => x.filter((y) => y !== l))}>✕</button> }]} />
        <ErrorNote error={save.error} />
      </div>
    </Modal>
  );
};

const OrderDetail = ({ id, onClose }: { id: string; onClose: () => void }) => {
  const { can } = useAuth();
  const client = useQueryClient();
  const toast = useToast();
  const detail = useQuery({ queryKey: ['purchase', id], queryFn: () => api<PurchaseDetail>(`/purchases/${id}`) });
  const [qty, setQty] = useState<Record<string, string>>({});
  const [expiry, setExpiry] = useState<Record<string, string>>({});
  const done = () => { void client.invalidateQueries({ queryKey: ['purchases'] }); void client.invalidateQueries({ queryKey: ['purchase', id] }); };
  const receive = useMutation({
    mutationFn: () => api('/purchases/' + id + '/receive', { method: 'POST', body: { items: detail.data!.items.map((i) => ({ itemId: i.id, quantity: Number(qty[i.id] ?? num(i.quantityOrdered) - num(i.quantityReceived)), expiryDate: expiry[i.id] ? new Date(expiry[i.id]!).toISOString() : undefined })).filter((i) => i.quantity > 0) } }),
    onSuccess: () => { toast('success', 'Goods received and stock updated'); done(); },
  });
  const cancel = useMutation({ mutationFn: () => api(`/purchases/${id}/cancel`, { method: 'POST' }), onSuccess: () => { toast('success', 'Order cancelled'); done(); } });
  const d = detail.data;
  return (
    <Modal open onClose={onClose} title={d ? `Order ${d.number}` : 'Order'} width="lg"
      footer={d?.status === 'ORDERED' ? <>{can('purchase:write') && <Button variant="danger" onClick={() => cancel.mutate()} loading={cancel.isPending}>Cancel order</Button>}{can('stock:receive') && <Button onClick={() => receive.mutate()} loading={receive.isPending}>Receive goods</Button>}</> : undefined}>
      {d && <>
        <p className="mb-3 text-sm text-muted">{d.supplier.name} · {dateTime(d.createdAt)} · <Badge tone={TONE[d.status]}>{label(d.status)}</Badge> · <b className="text-ink">{money(d.total)}</b></p>
        <DataTable rowKey={(i) => i.id} rows={d.items} columns={[
          { header: 'Product', cell: (i) => i.product.name }, { header: 'Ordered', cell: (i) => fmtNum(i.quantityOrdered), align: 'right' }, { header: 'Received', cell: (i) => fmtNum(i.quantityReceived), align: 'right' },
          ...(d.status === 'ORDERED' ? [{ header: 'Receive now', cell: (i: PurchaseItem) => <span className="flex gap-1"><input aria-label={`Receive ${i.product.name}`} className="w-20 rounded-field border border-line px-2 py-1" inputMode="decimal" defaultValue={num(i.quantityOrdered) - num(i.quantityReceived)} onChange={(e) => setQty({ ...qty, [i.id]: e.target.value })} />{i.product.tracksExpiry && <input aria-label={`Expiry ${i.product.name}`} type="date" className="rounded-field border border-line px-2 py-1" onChange={(e) => setExpiry({ ...expiry, [i.id]: e.target.value })} />}</span> }] : [])]} />
        <div className="mt-3"><ErrorNote error={receive.error ?? cancel.error} /></div>
      </>}
    </Modal>
  );
};

export const Purchases = () => {
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const list = usePage<PurchaseRow>('purchases', '/purchases', { page, pageSize: 25 });
  return (
    <>
      <PageHeader title="Purchases" subtitle="Purchase orders and goods received">{can('purchase:write') && <Button onClick={() => setCreating(true)}>New purchase order</Button>}</PageHeader>
      <Panel className="!p-0">
        <DataTable rowKey={(p) => p.id} rows={list.data?.data} loading={list.isLoading} onRowClick={(p) => setOpen(p.id)} empty={<p className="p-10 text-center text-muted">No purchase orders yet.</p>} columns={[
          { header: 'Number', cell: (p) => <b>{p.number}</b> }, { header: 'Supplier', cell: (p) => p.supplier.name }, { header: 'Date', cell: (p) => date(p.createdAt) },
          { header: 'Status', cell: (p) => <Badge tone={TONE[p.status]}>{label(p.status)}</Badge> }, { header: 'Payment', cell: (p) => (p.status === 'RECEIVED' ? <Badge tone={p.paymentStatus === 'PAID' ? 'good' : 'warn'}>{p.paymentStatus === 'PAID' ? 'Paid' : 'Unpaid'}</Badge> : '—') }, { header: 'Total', cell: (p) => money(p.total), align: 'right' }]} />
        <Pagination meta={list.data?.meta} onPage={setPage} />
      </Panel>
      {creating && <NewOrder onClose={() => setCreating(false)} />}
      {open && <OrderDetail id={open} onClose={() => setOpen(null)} />}
    </>
  );
};
