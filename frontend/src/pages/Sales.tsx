import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useApproval } from '../components/ApprovalDialog';
import { BranchSelect } from '../components/BranchSelect';
import { ReceiptView } from '../components/Receipt';
import { Badge, Button, DataTable, ErrorNote, Modal, PageHeader, Pagination, Panel, Select, Tabs, Textarea, inputCls, useToast } from '../components/ui';
import { api, downloadFile } from '../lib/api';
import { printPage } from '../lib/desktop';
import { useAuth } from '../lib/auth';
import { amt, dateTime, fmtNum, label, money, num } from '../lib/format';
import { queue, type PendingSale } from '../lib/offline';
import { usePage } from '../lib/queries';
import { useSync } from '../lib/sync';
import type { PaymentMethod, Receipt, Sale } from '../lib/types';

interface SaleRow extends Sale { cashierName: string | null }

const ReturnForm = ({ sale, onDone }: { sale: Sale; onDone: () => void }) => {
  const toast = useToast();
  const { run, dialog } = useApproval();
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const items = sale.items.filter((i) => num(i.quantity) - num(i.returnedQty) > 0);
  const chosen = items.map((i) => ({ saleItemId: i.id, quantity: amt(qty[i.id] ?? 0) })).filter((i) => i.quantity > 0);
  const refund = items.reduce((s, i) => s + (amt(qty[i.id]) * num(i.lineTotal)) / num(i.quantity), 0);
  const save = useMutation({
    mutationFn: () => run('Refunds need a manager’s approval.', (approval) => api('/returns', { method: 'POST', body: { saleId: sale.id, reason, method, items: chosen, approval } })),
    onSuccess: () => { toast('success', 'Return recorded'); onDone(); },
  });
  if (!items.length) return <p className="text-sm text-muted">Everything on this receipt has already been returned.</p>;
  return (
    <div className="space-y-3">
      <DataTable rowKey={(i) => i.id} rows={items} columns={[
        { header: 'Item', cell: (i) => i.name }, { header: 'Returnable', cell: (i) => fmtNum(num(i.quantity) - num(i.returnedQty)), align: 'right' },
        { header: 'Return qty', cell: (i) => <input aria-label={`Return quantity ${i.name}`} inputMode="decimal" className="w-20 rounded-field border border-line px-2 py-1" value={qty[i.id] ?? ''} onChange={(e) => setQty({ ...qty, [i.id]: e.target.value })} /> }]} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Refund method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>{(['CASH', 'MOBILE_MONEY', 'CARD', 'OTHER'] as const).map((m) => <option key={m} value={m}>{label(m)}</option>)}</Select>
        <Textarea label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div className="flex items-center gap-3"><Button onClick={() => save.mutate()} disabled={!chosen.length || reason.length < 3} loading={save.isPending}>Refund {money(refund)}</Button><ErrorNote error={save.error} /></div>
      {dialog}
    </div>
  );
};

const SaleModal = ({ id, onClose }: { id: string; onClose: () => void }) => {
  const toast = useToast();
  const client = useQueryClient();
  const { run, dialog } = useApproval();
  const [mode, setMode] = useState<'receipt' | 'return' | 'void'>('receipt');
  const [reason, setReason] = useState('');
  const receipt = useQuery({ queryKey: ['receipt', id], queryFn: () => api<Receipt>(`/sales/${id}/receipt`) });
  const refresh = () => { void client.invalidateQueries({ queryKey: ['sales'] }); void receipt.refetch(); setMode('receipt'); };
  const voidSale = useMutation({
    mutationFn: () => run('Voiding a sale needs a manager’s approval.', (approval) => api(`/sales/${id}/void`, { method: 'POST', body: { reason, approval } })),
    onSuccess: () => { toast('success', 'Sale voided and stock restored'); refresh(); },
  });
  const sale = receipt.data?.sale;
  return (
    <Modal open onClose={onClose} title={sale ? `Sale ${sale.receiptNo}` : 'Sale'} width="md">
      {sale && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Badge tone={sale.status === 'VOIDED' ? 'bad' : 'good'}>{label(sale.status)}</Badge>
            {sale.offline && <Badge tone="warn">Sold offline</Badge>}
            <span className="ml-auto flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => void printPage()}>Print</Button>
              <Button size="sm" variant="secondary" onClick={() => void downloadFile(`/sales/${id}/receipt.pdf`, undefined, `${sale.receiptNo}.pdf`)}>PDF</Button>
              {sale.status === 'COMPLETED' && <Button size="sm" variant="secondary" onClick={() => setMode('return')}>Return items</Button>}
              {sale.status === 'COMPLETED' && <Button size="sm" variant="danger" onClick={() => setMode('void')}>Void</Button>}
            </span>
          </div>
          {mode === 'receipt' && <ReceiptView receipt={receipt.data!} />}
          {mode === 'return' && <ReturnForm sale={sale} onDone={refresh} />}
          {mode === 'void' && (
            <div className="space-y-3">
              <p className="text-sm">Voiding cancels the whole sale and puts every item back in stock. The receipt stays on record.</p>
              <Textarea label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
              <div className="flex items-center gap-3"><Button variant="danger" onClick={() => voidSale.mutate()} disabled={reason.length < 3} loading={voidSale.isPending}>Void this sale</Button><Button variant="ghost" onClick={() => setMode('receipt')}>Back</Button></div>
              <ErrorNote error={voidSale.error} />
            </div>
          )}
          {!!sale.returns?.length && <p className="mt-3 text-sm text-muted">Returns: {sale.returns.map((r) => `${r.number} (${money(r.refundAmount)})`).join(', ')}</p>}
        </>
      )}
      {dialog}
    </Modal>
  );
};

const QueuedSales = () => {
  const { syncNow, online } = useSync();
  const [items, setItems] = useState<PendingSale[]>([]);
  useEffect(() => {
    const load = () => void queue.list().then(setItems);
    load();
    window.addEventListener('pos:queue', load);
    return () => window.removeEventListener('pos:queue', load);
  }, []);
  if (!items.length) return null;
  return (
    <Panel title={`Waiting to sync (${items.length})`} className="mb-4 border-warn" actions={<Button size="sm" onClick={() => { void queue.retryFailed().then(syncNow); }} disabled={!online}>Sync now</Button>}>
      <ul className="divide-y divide-line text-sm">
        {items.map((i) => (
          <li key={i.clientId} className="flex items-center justify-between py-2">
            <span>{dateTime(i.receipt.soldAt)} · <b>{money(i.receipt.total)}</b></span>
            {i.status === 'failed' ? <span className="text-danger">Rejected: {i.error}</span> : <Badge tone="warn">Queued</Badge>}
          </li>
        ))}
      </ul>
    </Panel>
  );
};

interface RefundRow { id: string; number: string; createdAt: string; method: PaymentMethod; refundAmount: string; reason: string; sale: { receiptNo: string } }

const Refunds = ({ branchId }: { branchId: string }) => {
  const [page, setPage] = useState(1);
  const list = usePage<RefundRow>('returns', '/returns', { page, pageSize: 25, branchId: branchId || undefined });
  return (
    <Panel className="!p-0">
      <DataTable rowKey={(r) => r.id} rows={list.data?.data} loading={list.isLoading} empty={<p className="p-10 text-center text-muted">No refunds recorded.</p>} columns={[
        { header: 'Refund', cell: (r) => <b>{r.number}</b> }, { header: 'Date', cell: (r) => dateTime(r.createdAt) }, { header: 'Receipt', cell: (r) => r.sale.receiptNo },
        { header: 'Method', cell: (r) => label(r.method) }, { header: 'Reason', cell: (r) => r.reason }, { header: 'Amount', cell: (r) => <b>{money(r.refundAmount)}</b>, align: 'right' }]} />
      <Pagination meta={list.data?.meta} onPage={setPage} />
    </Panel>
  );
};

export const Sales = () => {
  const { session, can } = useAuth();
  const [tab, setTab] = useState<'sales' | 'refunds'>('sales');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [branchId, setBranchId] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const list = usePage<SaleRow>('sales', '/sales', { page, pageSize: 25, search, branchId: branchId || undefined });
  return (
    <>
      <PageHeader title="Sales" subtitle={session?.user.role === 'CASHIER' ? 'Your sales' : 'Receipts, returns and voids'}>
        <input aria-label="Search receipt" className={`${inputCls} !w-56`} placeholder="Receipt number" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <BranchSelect value={branchId} onChange={setBranchId} />
      </PageHeader>
      {can('sale:read-all') && <Tabs value={tab} onChange={setTab} tabs={[{ id: 'sales', label: 'Sales' }, { id: 'refunds', label: 'Refunds' }]} />}
      {tab === 'refunds' ? <Refunds branchId={branchId} /> : <>
      <QueuedSales />
      <Panel className="!p-0">
        <DataTable rowKey={(s) => s.id} rows={list.data?.data} loading={list.isLoading} onRowClick={(s) => setOpen(s.id)} empty={<p className="p-10 text-center text-muted">No sales found.</p>} columns={[
          { header: 'Receipt', cell: (s) => <b>{s.receiptNo}</b> }, { header: 'Date', cell: (s) => dateTime(s.soldAt) }, { header: 'Cashier', cell: (s) => s.cashierName ?? '—' },
          { header: 'Payment', cell: (s) => s.payments.map((p) => label(p.method)).join(' + ') },
          { header: 'Status', cell: (s) => (s.status === 'VOIDED' ? <Badge tone="bad">Voided</Badge> : s.offline ? <Badge tone="warn">Offline</Badge> : <Badge tone="good">Completed</Badge>) },
          { header: 'Total', cell: (s) => <b>{money(s.total)}</b>, align: 'right' }]} />
        <Pagination meta={list.data?.meta} onPage={setPage} />
      </Panel>
      </>}
      {open && <SaleModal id={open} onClose={() => setOpen(null)} />}
    </>
  );
};

