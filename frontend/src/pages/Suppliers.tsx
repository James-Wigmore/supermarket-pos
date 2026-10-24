import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Button, Confirm, DataTable, ErrorNote, Input, Modal, PageHeader, Pagination, Panel, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { date, money, num, currencyCode } from '../lib/format';
import { errorMessage } from '../lib/hooks';
import { usePage } from '../lib/queries';
import type { Supplier } from '../lib/types';

interface History { supplier: Supplier; purchases: { id: string; number: string; total: string; status: string; paymentStatus: 'PAID' | 'UNPAID'; paidAmount: string; createdAt: string }[]; payments: { id: string; amount: string; note: string | null; createdAt: string }[] }

const SupplierForm = ({ supplier, onClose }: { supplier: Supplier | null; onClose: () => void }) => {
  const client = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ name: supplier?.name ?? '', contact: supplier?.contact ?? '', phone: supplier?.phone ?? '', email: supplier?.email ?? '', address: supplier?.address ?? '' });
  const save = useMutation({
    mutationFn: () => { const body = Object.fromEntries(Object.entries(f).filter(([k, v]) => v !== '' || (supplier && k !== 'name'))); return supplier ? api(`/suppliers/${supplier.id}`, { method: 'PATCH', body }) : api('/suppliers', { method: 'POST', body }); },
    onSuccess: () => { toast('success', 'Supplier saved'); void client.invalidateQueries({ queryKey: ['suppliers'] }); void client.invalidateQueries({ queryKey: ['ref'] }); onClose(); },
  });
  return (
    <Modal open onClose={onClose} title={supplier ? 'Edit supplier' : 'New supplier'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => save.mutate()} loading={save.isPending} disabled={!f.name}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="sm:col-span-2" autoFocus />
        <Input label="Contact person" value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} />
        <Input label="Phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        <Input label="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <Input label="Address" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
      </div>
      <div className="mt-3"><ErrorNote error={save.error} /></div>
    </Modal>
  );
};

const SupplierDetail = ({ supplier, onClose }: { supplier: Supplier; onClose: () => void }) => {
  const { can } = useAuth();
  const client = useQueryClient();
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const history = useQuery({ queryKey: ['supplier-history', supplier.id], queryFn: () => api<History>(`/suppliers/${supplier.id}/history`) });
  const pay = useMutation({
    mutationFn: () => api(`/suppliers/${supplier.id}/payments`, { method: 'POST', body: { amount: Number(amount) } }),
    onSuccess: () => { toast('success', 'Payment recorded'); setAmount(''); void history.refetch(); void client.invalidateQueries({ queryKey: ['suppliers'] }); },
  });
  const setPaid = useMutation({
    mutationFn: ({ id, paid }: { id: string; paid: boolean }) => api(`/purchases/${id}/payment`, { method: 'PATCH', body: { paid } }),
    onSuccess: (_r, { paid }) => { toast('success', paid ? 'Marked as paid' : 'Marked as unpaid'); void history.refetch(); void client.invalidateQueries({ queryKey: ['suppliers'] }); void client.invalidateQueries({ queryKey: ['purchases'] }); },
  });
  const balance = history.data?.supplier.balance ?? supplier.balance;
  return (
    <Modal open onClose={onClose} title={supplier.name} width="lg">
      <p className="mb-1 text-sm text-muted">{[supplier.contact, supplier.phone, supplier.email].filter(Boolean).join(' · ') || 'No contact details'}</p>
      <p className="mb-4 text-lg">Balance owed: <b className={num(balance) > 0 ? 'text-danger' : ''}>{money(balance)}</b></p>
      {can('supplier:write') && <div className="mb-5 flex items-end gap-2"><Input label={`Record a payment (${currencyCode()})`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-56" /><Button onClick={() => pay.mutate()} disabled={!(Number(amount) > 0)} loading={pay.isPending}>Record payment</Button></div>}
      <ErrorNote error={pay.error ?? setPaid.error} />
      <h3 className="mb-1 mt-3 font-semibold">Purchases</h3>
      <DataTable rowKey={(p) => p.id} rows={history.data?.purchases} loading={history.isLoading} empty={<p className="py-4 text-sm text-muted">No purchases yet.</p>} columns={[{ header: 'Order', cell: (p) => p.number }, { header: 'Date', cell: (p) => date(p.createdAt) }, { header: 'Status', cell: (p) => <Badge>{p.status}</Badge> },
        { header: 'Payment', cell: (p) => (p.status !== 'RECEIVED' ? '—' : <span className="flex items-center gap-2"><Badge tone={p.paymentStatus === 'PAID' ? 'good' : 'warn'}>{p.paymentStatus === 'PAID' ? 'Paid' : num(p.paidAmount) > 0 ? `Part paid (${money(p.paidAmount)})` : 'Unpaid'}</Badge>{can('supplier:write') && <Button size="sm" variant="ghost" loading={setPaid.isPending && setPaid.variables?.id === p.id} onClick={() => setPaid.mutate({ id: p.id, paid: p.paymentStatus !== 'PAID' })}>{p.paymentStatus === 'PAID' ? 'Mark unpaid' : 'Mark paid'}</Button>}</span>) },
        { header: 'Total', cell: (p) => money(p.total), align: 'right' }]} />
      <h3 className="mb-1 mt-5 font-semibold">Payments</h3>
      <DataTable rowKey={(p) => p.id} rows={history.data?.payments} empty={<p className="py-4 text-sm text-muted">No payments recorded.</p>} columns={[{ header: 'Date', cell: (p) => date(p.createdAt) }, { header: 'Note', cell: (p) => p.note ?? '' }, { header: 'Amount', cell: (p) => money(p.amount), align: 'right' }]} />
    </Modal>
  );
};

export const Suppliers = () => {
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Supplier | null | 'new'>(null);
  const [viewing, setViewing] = useState<Supplier | null>(null);
  const [removing, setRemoving] = useState<Supplier | null>(null);
  const list = usePage<Supplier>('suppliers', '/suppliers', { page, pageSize: 25 });
  const client = useQueryClient();
  const toast = useToast();
  const toggle = useMutation({
    mutationFn: (supplier: Supplier) => api(`/suppliers/${supplier.id}`, { method: 'PATCH', body: { isActive: !supplier.isActive } }),
    onSuccess: (_result, supplier) => {
      toast('success', supplier.isActive ? 'Supplier removed from new selections' : 'Supplier restored');
      void client.invalidateQueries({ queryKey: ['suppliers'] });
      void client.invalidateQueries({ queryKey: ['ref'] });
      setRemoving(null);
    },
    onError: (err) => toast('error', errorMessage(err)),
  });
  return (
    <>
      <PageHeader title="Suppliers">{can('supplier:write') && <Button onClick={() => setEditing('new')}>New supplier</Button>}</PageHeader>
      <Panel className="!p-0">
        <DataTable rowKey={(s) => s.id} rows={list.data?.data} loading={list.isLoading} onRowClick={setViewing} empty={<p className="p-10 text-center text-muted">No suppliers yet.</p>} columns={[
          { header: 'Supplier', cell: (s) => <><b>{s.name}</b>{!s.isActive && <span className="ml-2"><Badge>Inactive</Badge></span>}</> }, { header: 'Contact', cell: (s) => [s.contact, s.phone].filter(Boolean).join(' · ') || '—' },
          { header: 'Payment', cell: (s) => (num(s.balance) > 0 ? <Badge tone="warn">Owing</Badge> : <Badge tone="good">Paid up</Badge>) },
          { header: 'Balance owed', cell: (s) => <span className={num(s.balance) > 0 ? 'font-semibold text-danger' : ''}>{money(s.balance)}</span>, align: 'right' },
          { header: '', cell: (s) => can('supplier:write') && <span className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}><Button size="sm" variant="secondary" onClick={() => setEditing(s)}>Edit</Button><Button size="sm" variant="ghost" onClick={() => setRemoving(s)}>{s.isActive ? 'Remove' : 'Restore'}</Button></span>, align: 'right' }]} />
        <Pagination meta={list.data?.meta} onPage={setPage} />
      </Panel>
      {editing && <SupplierForm supplier={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {viewing && <SupplierDetail supplier={viewing} onClose={() => setViewing(null)} />}
      <Confirm open={Boolean(removing)} danger={Boolean(removing?.isActive)} title={removing?.isActive ? 'Remove supplier?' : 'Restore supplier?'} message={removing?.isActive ? `${removing?.name} will be hidden from new product and purchase selections. Existing records will be kept.` : `${removing?.name} will be available for new selections again.`} confirmLabel={removing?.isActive ? 'Remove' : 'Restore'} onCancel={() => setRemoving(null)} onConfirm={() => removing && toggle.mutate(removing)} loading={toggle.isPending} />
    </>
  );
};
