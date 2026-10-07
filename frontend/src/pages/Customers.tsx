import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, DataTable, ErrorNote, Input, Modal, PageHeader, Pagination, Panel, inputCls, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateTime, money } from '../lib/format';
import { useDebounced } from '../lib/hooks';
import { usePage } from '../lib/queries';
import type { Customer } from '../lib/types';

const CustomerModal = ({ customer, onClose }: { customer: Customer | null; onClose: () => void }) => {
  const client = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ name: customer?.name ?? '', phone: customer?.phone ?? '', email: customer?.email ?? '' });
  const history = useQuery({ queryKey: ['customer-sales', customer?.id], queryFn: () => api<{ id: string; receiptNo: string; soldAt: string; total: string }[]>(`/customers/${customer!.id}/purchases`), enabled: Boolean(customer) });
  const save = useMutation({
    mutationFn: () => (customer ? api(`/customers/${customer.id}`, { method: 'PATCH', body: f }) : api('/customers', { method: 'POST', body: f })),
    onSuccess: () => { toast('success', 'Customer saved'); void client.invalidateQueries({ queryKey: ['customers'] }); onClose(); },
  });
  return (
    <Modal open onClose={onClose} title={customer ? customer.name : 'New customer'} footer={<><Button variant="secondary" onClick={onClose}>Close</Button><Button onClick={() => save.mutate()} loading={save.isPending} disabled={!f.name}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="sm:col-span-2" autoFocus />
        <Input label="Phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        <Input label="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      </div>
      <div className="mt-3"><ErrorNote error={save.error} /></div>
      {customer && (
        <>
          <p className="mt-5 text-sm text-muted">Loyalty points: <b className="text-ink">{customer.loyaltyPoints}</b></p>
          <h3 className="mb-1 mt-3 font-semibold">Purchase history</h3>
          <DataTable rowKey={(s) => s.id} rows={history.data} loading={history.isLoading} empty={<p className="py-4 text-sm text-muted">No purchases linked to this customer.</p>} columns={[{ header: 'Receipt', cell: (s) => s.receiptNo }, { header: 'Date', cell: (s) => dateTime(s.soldAt) }, { header: 'Total', cell: (s) => money(s.total), align: 'right' }]} />
        </>
      )}
    </Modal>
  );
};

export const Customers = () => {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Customer | null | 'new'>(null);
  const q = useDebounced(search);
  const list = usePage<Customer>('customers', '/customers', { search: q, page, pageSize: 25 });
  return (
    <>
      <PageHeader title="Customers" subtitle="Optional. Sales never require a customer.">
        <input aria-label="Search customers" className={`${inputCls} !w-60`} placeholder="Name, phone or email" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        {can('customer:write') && <Button onClick={() => setEditing('new')}>New customer</Button>}
      </PageHeader>
      <Panel className="!p-0">
        <DataTable rowKey={(c) => c.id} rows={list.data?.data} loading={list.isLoading} onRowClick={setEditing} empty={<p className="p-10 text-center text-muted">No customers yet.</p>} columns={[
          { header: 'Name', cell: (c) => <b>{c.name}</b> }, { header: 'Phone', cell: (c) => c.phone ?? '—' }, { header: 'Email', cell: (c) => c.email ?? '—' }, { header: 'Points', cell: (c) => c.loyaltyPoints, align: 'right' }]} />
        <Pagination meta={list.data?.meta} onPage={setPage} />
      </Panel>
      {editing && <CustomerModal customer={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
};
