import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { BranchSelect } from '../components/BranchSelect';
import { Badge, Button, DataTable, ErrorNote, Input, Modal, PageHeader, Panel, Select, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateTime, label } from '../lib/format';
import { useBranches } from '../lib/queries';
import type { Role } from '../lib/types';

interface User { id: string; email: string; name: string; role: Role; branchId: string | null; isActive: boolean; lastLoginAt: string | null; branch: { name: string } | null }

const ALL_ROLES: Role[] = ['SUPER_ADMIN', 'MANAGER', 'CASHIER', 'STOCK_OFFICER', 'ACCOUNTANT', 'AUDITOR'];
const MANAGER_ROLES: Role[] = ['CASHIER', 'STOCK_OFFICER'];

const UserForm = ({ user, onClose }: { user: User | null; onClose: () => void }) => {
  const { session } = useAuth();
  const client = useQueryClient();
  const toast = useToast();
  const admin = session?.user.role === 'SUPER_ADMIN';
  const branches = useBranches(admin);
  const [f, setF] = useState({ name: user?.name ?? '', email: user?.email ?? '', role: (user?.role ?? 'CASHIER') as Role, branchId: user?.branchId ?? '', password: '', isActive: user?.isActive ?? true });
  const save = useMutation({
    mutationFn: () => (user
      ? api(`/users/${user.id}`, { method: 'PATCH', body: { name: f.name, role: f.role, isActive: f.isActive, ...(admin && f.role !== 'SUPER_ADMIN' ? { branchId: f.branchId || undefined } : {}), ...(f.password ? { password: f.password } : {}) } })
      : api('/users', { method: 'POST', body: { name: f.name, email: f.email, role: f.role, password: f.password, branchId: f.branchId || undefined } })),
    onSuccess: () => { toast('success', 'User saved'); void client.invalidateQueries({ queryKey: ['users'] }); onClose(); },
  });
  return (
    <Modal open onClose={onClose} title={user ? 'Edit user' : 'New user'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => save.mutate()} loading={save.isPending} disabled={!f.name || !f.email || (!user && f.password.length < 8)}>Save user</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
        <Input label="Email" type="email" value={f.email} disabled={Boolean(user)} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <Select label="Role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>{(admin ? ALL_ROLES : MANAGER_ROLES).map((r) => <option key={r} value={r}>{label(r)}</option>)}</Select>
        {admin && f.role !== 'SUPER_ADMIN' && <Select label="Branch" value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}><option value="">Select…</option>{branches.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>}
        <Input label={user ? 'New password (optional)' : 'Password'} type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} hint="At least 8 characters" />
        {user && <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Account active</label>}
      </div>
      <div className="mt-3"><ErrorNote error={save.error} /></div>
    </Modal>
  );
};

export const Users = () => {
  const [branchId, setBranchId] = useState('');
  const [editing, setEditing] = useState<User | null | 'new'>(null);
  const users = useQuery({ queryKey: ['users', branchId], queryFn: () => api<User[]>('/users', { query: { branchId: branchId || undefined } }) });
  return (
    <>
      <PageHeader title="Users" subtitle="Staff accounts and roles"><BranchSelect value={branchId} onChange={setBranchId} /><Button onClick={() => setEditing('new')}>New user</Button></PageHeader>
      <Panel className="!p-0">
        <DataTable rowKey={(u) => u.id} rows={users.data} loading={users.isLoading} onRowClick={setEditing} columns={[
          { header: 'Name', cell: (u) => <><b>{u.name}</b><div className="text-xs text-muted">{u.email}</div></> }, { header: 'Role', cell: (u) => <Badge>{label(u.role)}</Badge> }, { header: 'Branch', cell: (u) => u.branch?.name ?? 'All branches' },
          { header: 'Last sign-in', cell: (u) => dateTime(u.lastLoginAt) }, { header: 'Status', cell: (u) => (u.isActive ? <Badge tone="good">Active</Badge> : <Badge tone="bad">Disabled</Badge>) }]} />
      </Panel>
      {editing && <UserForm user={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
};
