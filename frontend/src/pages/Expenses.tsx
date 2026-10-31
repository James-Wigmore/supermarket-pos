import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { BranchSelect } from '../components/BranchSelect';
import { Button, Confirm, DataTable, ErrorNote, Input, Modal, PageHeader, Pagination, Panel, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { amt, date, money, currencyCode } from '../lib/format';
import { usePage } from '../lib/queries';

interface Expense { id: string; category: string; amount: string; description: string | null; incurredAt: string }

const ExpenseForm = ({ branchId, onClose }: { branchId: string; onClose: () => void }) => {
  const client = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ category: '', amount: '', description: '', incurredAt: new Date().toISOString().slice(0, 10) });
  const save = useMutation({
    mutationFn: () => api('/expenses', { method: 'POST', body: { category: f.category, amount: amt(f.amount), description: f.description || undefined, incurredAt: new Date(f.incurredAt).toISOString(), branchId: branchId || undefined } }),
    onSuccess: () => { toast('success', 'Expense recorded'); void client.invalidateQueries({ queryKey: ['expenses'] }); onClose(); },
  });
  return (
    <Modal open onClose={onClose} title="New expense" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => save.mutate()} loading={save.isPending} disabled={!f.category || !(amt(f.amount) > 0)}>Save expense</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Category" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="Rent, electricity, salaries…" autoFocus />
        <Input label={`Amount (${currencyCode()})`} inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        <Input label="Date" type="date" value={f.incurredAt} onChange={(e) => setF({ ...f, incurredAt: e.target.value })} />
        <Input label="Description" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </div>
      <div className="mt-3"><ErrorNote error={save.error} /></div>
    </Modal>
  );
};

export const Expenses = () => {
  const { can, session } = useAuth();
  const client = useQueryClient();
  const [page, setPage] = useState(1);
  const [branchId, setBranchId] = useState('');
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Expense | null>(null);
  const list = usePage<Expense>('expenses', '/expenses', { page, pageSize: 25, branchId: branchId || undefined });
  const del = useMutation({ mutationFn: (id: string) => api(`/expenses/${id}`, { method: 'DELETE' }), onSuccess: () => { setDeleting(null); void client.invalidateQueries({ queryKey: ['expenses'] }); } });
  const needsBranch = session?.user.role === 'SUPER_ADMIN' && !branchId;
  return (
    <>
      <PageHeader title="Expenses"><BranchSelect value={branchId} onChange={setBranchId} />{can('expense:write') && <Button onClick={() => setCreating(true)} disabled={needsBranch} title={needsBranch ? 'Pick a branch first' : undefined}>New expense</Button>}</PageHeader>
      <Panel className="!p-0">
        <DataTable rowKey={(e) => e.id} rows={list.data?.data} loading={list.isLoading} empty={<p className="p-10 text-center text-muted">No expenses recorded.</p>} columns={[
          { header: 'Date', cell: (e) => date(e.incurredAt) }, { header: 'Category', cell: (e) => <b>{e.category}</b> }, { header: 'Description', cell: (e) => e.description ?? '' }, { header: 'Amount', cell: (e) => money(e.amount), align: 'right' },
          { header: '', cell: (e) => can('expense:write') && <button type="button" className="text-danger" onClick={() => setDeleting(e)}>Delete</button>, align: 'right' }]} />
        <Pagination meta={list.data?.meta} onPage={setPage} />
      </Panel>
      {creating && <ExpenseForm branchId={branchId} onClose={() => setCreating(false)} />}
      <Confirm open={Boolean(deleting)} title="Delete expense?" message="This removes the expense from financial reports." confirmLabel="Delete" danger onCancel={() => setDeleting(null)} onConfirm={() => deleting && del.mutate(deleting.id)} loading={del.isPending} />
    </>
  );
};
