import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { BranchSelect } from '../components/BranchSelect';
import { Badge, Button, DataTable, ErrorNote, Input, Modal, PageHeader, Pagination, Panel, Select, Tabs, Textarea, inputCls, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { date, dateTime, fmtNum, label, money, num } from '../lib/format';
import { useDebounced } from '../lib/hooks';
import { useBranches, usePage } from '../lib/queries';


interface StockRow { id: string; sku: string; name: string; unit: string; minStock: string; quantity: string; value: string; category: string | null; purchasePrice: string; tracksExpiry: boolean }
interface Movement { id: string; createdAt: string; type: string; quantity: string; reference: string | null; notes: string | null; userName: string | null; product: { name: string; unit: string }; batch: { batchNo: string } | null }
interface Batch { id: string; batchNo: string; expiryDate: string; quantity: string; product: { name: string; unit: string } }

const ADJUST_TYPES = [
  ['DAMAGED', 'Damaged stock (remove)'], ['EXPIRED', 'Expired stock (remove)'], ['LOSS', 'Loss or theft (remove)'],
  ['ADJUSTMENT_IN', 'Stock count correction: add'], ['ADJUSTMENT_OUT', 'Stock count correction: remove'], ['OPENING', 'Opening stock (add)'],
] as const;

const AdjustModal = ({ row, branchId, onClose }: { row: StockRow; branchId: string; onClose: () => void }) => {
  const client = useQueryClient();
  const toast = useToast();
  const [type, setType] = useState<(typeof ADJUST_TYPES)[number][0]>('DAMAGED');
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const [expiry, setExpiry] = useState('');
  const adding = type === 'OPENING' || type === 'ADJUSTMENT_IN';
  const save = useMutation({
    mutationFn: () => api('/inventory/adjust', { method: 'POST', body: {
      productId: row.id, branchId: branchId || undefined, quantity: Number(quantity), notes,
      type: type.startsWith('ADJUSTMENT') ? 'ADJUSTMENT' : type, direction: type === 'ADJUSTMENT_IN' ? 'IN' : type === 'ADJUSTMENT_OUT' ? 'OUT' : undefined,
      expiryDate: adding && expiry ? new Date(expiry).toISOString() : undefined } }),
    onSuccess: () => { toast('success', 'Stock adjusted'); void client.invalidateQueries({ queryKey: ['stock'] }); void client.invalidateQueries({ queryKey: ['movements'] }); onClose(); },
  });
  return (
    <Modal open onClose={onClose} title={`Adjust stock: ${row.name}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => save.mutate()} loading={save.isPending} disabled={!(Number(quantity) > 0) || notes.length < 3}>Save adjustment</Button></>}>
      <p className="mb-3 text-sm text-muted">Currently {fmtNum(row.quantity)} {row.unit} in stock.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Reason" value={type} onChange={(e) => setType(e.target.value as typeof type)} className="sm:col-span-2">{ADJUST_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
        <Input label={`Quantity (${row.unit})`} inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} autoFocus />
        {adding && row.tracksExpiry && <Input label="Expiry date" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />}
        <Textarea label="Notes (required)" value={notes} onChange={(e) => setNotes(e.target.value)} className="sm:col-span-2" />
      </div>
      {type === 'EXPIRED' && row.tracksExpiry && <p className="mt-2 text-sm text-warn">Expired batches are written off from the Expiry tab, where you can pick the batch.</p>}
      <div className="mt-3"><ErrorNote error={save.error} /></div>
    </Modal>
  );
};

const TransferModal = ({ row, branchId, onClose }: { row: StockRow; branchId: string; onClose: () => void }) => {
  const client = useQueryClient();
  const toast = useToast();
  const branches = useBranches();
  const [to, setTo] = useState('');
  const [quantity, setQuantity] = useState('');
  const save = useMutation({
    mutationFn: () => api('/inventory/transfer', { method: 'POST', body: { productId: row.id, fromBranchId: branchId || undefined, toBranchId: to, quantity: Number(quantity) } }),
    onSuccess: () => { toast('success', 'Stock transferred'); void client.invalidateQueries({ queryKey: ['stock'] }); onClose(); },
  });
  return (
    <Modal open onClose={onClose} title={`Transfer: ${row.name}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => save.mutate()} loading={save.isPending} disabled={!to || !(Number(quantity) > 0)}>Transfer</Button></>}>
      <div className="space-y-3">
        <Select label="Destination branch" value={to} onChange={(e) => setTo(e.target.value)}><option value="">Select…</option>{branches.data?.filter((b) => b.id !== branchId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
        <Input label={`Quantity (${row.unit})`} inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        <ErrorNote error={save.error} />
      </div>
    </Modal>
  );
};

export const Inventory = () => {
  const { can, session } = useAuth();
  const [tab, setTab] = useState<'stock' | 'movements' | 'expiry'>('stock');
  const [branchId, setBranchId] = useState(session?.user.role === 'SUPER_ADMIN' ? '' : session?.user.branchId ?? '');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | 'low' | 'out'>('all');
  const [window_, setWindow] = useState('30');
  const [page, setPage] = useState(1);
  const [adjust, setAdjust] = useState<StockRow | null>(null);
  const [transfer, setTransfer] = useState<StockRow | null>(null);
  const q = useDebounced(search);
  const scoped = { branchId: branchId || undefined, page, pageSize: 25 };
  const stock = usePage<StockRow>('stock', '/inventory', { ...scoped, search: q, status }, tab === 'stock');
  const movements = usePage<Movement>('movements', '/inventory/movements', scoped, tab === 'movements');
  const batches = usePage<Batch>('batches', '/inventory/batches', { ...scoped, window: window_ }, tab === 'expiry');
  const needsBranch = session?.user.role === 'SUPER_ADMIN' && !branchId;
  const valueTotal = stock.data?.data.reduce((s, r) => s + num(r.value), 0) ?? 0;

  return (
    <>
      <PageHeader title="Inventory" subtitle="Stock levels, movements and expiry"><BranchSelect value={branchId} onChange={(v) => { setBranchId(v); setPage(1); }} /></PageHeader>
      <Tabs value={tab} onChange={(t) => { setTab(t); setPage(1); }} tabs={[{ id: 'stock', label: 'Stock levels' }, { id: 'movements', label: 'Movements' }, { id: 'expiry', label: 'Expiry' }]} />
      {tab === 'stock' && (
        <Panel className="!p-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
            <input aria-label="Search stock" placeholder="Search product or SKU" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className={`${inputCls} !w-64`} />
            <select aria-label="Stock status" value={status} onChange={(e) => { setStatus(e.target.value as typeof status); setPage(1); }} className={`${inputCls} !w-auto`}><option value="all">All products</option><option value="low">Low stock</option><option value="out">Out of stock</option></select>
            <span className="ml-auto text-sm text-muted">Value on this page: <b className="text-ink">{money(valueTotal)}</b></span>
          </div>
          <DataTable rowKey={(r) => r.id} rows={stock.data?.data} loading={stock.isLoading} columns={[
            { header: 'Product', cell: (r) => <><div className="font-medium">{r.name}</div><div className="text-xs text-muted">{r.category ?? 'Uncategorised'} · {r.sku}</div></> },
            { header: 'In stock', cell: (r) => <span className={num(r.quantity) <= 0 ? 'font-bold text-danger' : num(r.quantity) <= num(r.minStock) ? 'font-bold text-warn' : 'font-medium'}>{fmtNum(r.quantity)} {r.unit}</span>, align: 'right' },
            { header: 'Min', cell: (r) => fmtNum(r.minStock), align: 'right' },
            { header: 'Value', cell: (r) => money(r.value), align: 'right' },
            { header: '', cell: (r) => <span className="flex justify-end gap-1">{can('stock:adjust') && !needsBranch && <Button size="sm" variant="secondary" onClick={() => setAdjust(r)}>Adjust</Button>}{can('stock:transfer') && !needsBranch && <Button size="sm" variant="ghost" onClick={() => setTransfer(r)}>Transfer</Button>}</span> }]} />
          <Pagination meta={stock.data?.meta} onPage={setPage} />
        </Panel>
      )}
      {tab === 'movements' && (
        <Panel className="!p-0">
          <DataTable rowKey={(m) => m.id} rows={movements.data?.data} loading={movements.isLoading} columns={[
            { header: 'When', cell: (m) => dateTime(m.createdAt) }, { header: 'Product', cell: (m) => m.product.name },
            { header: 'Type', cell: (m) => <Badge tone={num(m.quantity) < 0 ? 'warn' : 'good'}>{label(m.type)}</Badge> },
            { header: 'Qty', cell: (m) => `${num(m.quantity) > 0 ? '+' : ''}${fmtNum(m.quantity)}`, align: 'right' },
            { header: 'Reference', cell: (m) => m.reference ?? '—' }, { header: 'By', cell: (m) => m.userName ?? '—' }, { header: 'Notes', cell: (m) => m.notes ?? '' }]} />
          <Pagination meta={movements.data?.meta} onPage={setPage} />
        </Panel>
      )}
      {tab === 'expiry' && (
        <Panel className="!p-0">
          <div className="border-b border-line p-3"><select aria-label="Expiry window" value={window_} onChange={(e) => { setWindow(e.target.value); setPage(1); }} className={`${inputCls} !w-auto`}><option value="expired">Already expired</option><option value="today">Expiring today</option><option value="7">Within 7 days</option><option value="30">Within 30 days</option><option value="all">All batches</option></select></div>
          <DataTable rowKey={(b) => b.id} rows={batches.data?.data} loading={batches.isLoading} empty={<p className="p-10 text-center text-muted">No batches in this window.</p>} columns={[
            { header: 'Product', cell: (b) => b.product.name }, { header: 'Batch', cell: (b) => b.batchNo },
            { header: 'Expires', cell: (b) => <Badge tone={new Date(b.expiryDate) < new Date(new Date().toDateString()) ? 'bad' : new Date(b.expiryDate).getTime() - Date.now() < 7 * 864e5 ? 'warn' : 'neutral'}>{date(b.expiryDate)}</Badge> },
            { header: 'Quantity', cell: (b) => `${fmtNum(b.quantity)} ${b.product.unit}`, align: 'right' }]} />
          <Pagination meta={batches.data?.meta} onPage={setPage} />
        </Panel>
      )}
      {adjust && <AdjustModal row={adjust} branchId={branchId} onClose={() => setAdjust(null)} />}
      {transfer && <TransferModal row={transfer} branchId={branchId} onClose={() => setTransfer(null)} />}
    </>
  );
};

