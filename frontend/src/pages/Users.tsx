import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { BranchSelect } from '../components/BranchSelect';
import { Badge, Button, DataTable, ErrorNote, Input, Modal, PageHeader, Panel, Select, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateTime, label } from '../lib/format';
import { loadSettings, useBranches } from '../lib/queries';
import type { Role } from '../lib/types';

interface User { id: string; email: string; name: string; role: Role; branchId: string | null; isActive: boolean; lastLoginAt: string | null; emailApprovalEnabled: boolean; branch: { name: string } | null }

const ALL_ROLES: Role[] = ['SUPER_ADMIN', 'MANAGER', 'CASHIER', 'STOCK_OFFICER', 'ACCOUNTANT', 'AUDITOR'];
const MANAGER_ROLES: Role[] = ['CASHIER', 'STOCK_OFFICER'];
/** Mirrors the server: a user can only be managed (password, email) by someone ranked above them. */
const RANK: Record<Role, number> = { SUPER_ADMIN: 3, MANAGER: 2, CASHIER: 1, STOCK_OFFICER: 1, ACCOUNTANT: 1, AUDITOR: 1 };

const UserForm = ({ user, onClose }: { user: User | null; onClose: () => void }) => {
  const { session } = useAuth();
  const client = useQueryClient();
  const toast = useToast();
  const admin = session?.user.role === 'SUPER_ADMIN';
  const branches = useBranches(admin);
  const [f, setF] = useState({ name: user?.name ?? '', email: user?.email ?? '', role: (user?.role ?? 'CASHIER') as Role, branchId: user?.branchId ?? '', password: '', isActive: user?.isActive ?? true });
  const save = useMutation({
    mutationFn: () => (user
      ? api(`/users/${user.id}`, { method: 'PATCH', body: { name: f.name, role: f.role, isActive: f.isActive, ...(admin && f.role !== 'SUPER_ADMIN' ? { branchId: f.branchId || undefined } : {}) } })
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
        {!user && <Input label="Password" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} hint="At least 8 characters. Later changes go through a manager reset." />}
        {user && <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Account active</label>}
      </div>
      <div className="mt-3"><ErrorNote error={save.error} /></div>
    </Modal>
  );
};

const ResetPassword = ({ user, onClose }: { user: User; onClose: () => void }) => {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const save = useMutation({
    mutationFn: () => api(`/users/${user.id}/password`, { method: 'POST', body: { password } }),
    onSuccess: () => { toast('success', `Password reset for ${user.name}. They are signed out everywhere.`); onClose(); },
  });
  const ready = password.length >= 8 && password === again;
  return (
    <Modal open onClose={onClose} title={`Reset password: ${user.name}`} width="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => save.mutate()} loading={save.isPending} disabled={!ready}>Reset password</Button></>}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (ready) save.mutate(); }}>
        <p className="text-sm text-muted">Choose a new password and give it to {user.name} in person. They will be signed out of every device.</p>
        <Input label="New password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} hint="At least 8 characters" autoFocus />
        <Input label="Repeat new password" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} error={again && again !== password ? 'The two passwords do not match' : undefined} />
        <ErrorNote error={save.error} />
        <button type="submit" hidden />
      </form>
    </Modal>
  );
};

const ChangeEmail = ({ user, onClose }: { user: User; onClose: () => void }) => {
  const toast = useToast();
  const client = useQueryClient();
  const [email, setEmail] = useState(user.email);
  const save = useMutation({
    mutationFn: () => api(`/users/${user.id}/email`, { method: 'PATCH', body: { email: email.trim() } }),
    onSuccess: () => { toast('success', `Email changed for ${user.name}. They are signed out and use the new address to sign in.`); void client.invalidateQueries({ queryKey: ['users'] }); onClose(); },
  });
  const ready = email.includes('@') && email.trim().toLowerCase() !== user.email;
  return (
    <Modal open onClose={onClose} title={`Change email: ${user.name}`} width="sm" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => save.mutate()} loading={save.isPending} disabled={!ready}>Change email</Button></>}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (ready) save.mutate(); }}>
        <p className="text-sm text-muted">Sign-in approval emails are sent to this address. Use it to fix a mistyped or lost address. Check it with {user.name} first.</p>
        <Input label="New email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        <ErrorNote error={save.error} />
        <button type="submit" hidden />
      </form>
    </Modal>
  );
};

export const Users = () => {
  const { session } = useAuth();
  const [resetting, setResetting] = useState<User | null>(null);
  const [changingEmail, setChangingEmail] = useState<User | null>(null);
  const me = session?.user.role;
  const canManage = (u: User) => Boolean(me && RANK[me] > RANK[u.role]);
  const settings = useQuery({ queryKey: ['settings'], queryFn: loadSettings });
  const [branchId, setBranchId] = useState('');
  const [editing, setEditing] = useState<User | null | 'new'>(null);
  const users = useQuery({ queryKey: ['users', branchId], queryFn: () => api<User[]>('/users', { query: { branchId: branchId || undefined } }) });
  return (
    <>
      <PageHeader title="Users" subtitle="Staff accounts and roles"><BranchSelect value={branchId} onChange={setBranchId} /><Button onClick={() => setEditing('new')}>New user</Button></PageHeader>
      <Panel className="!p-0">
        <DataTable rowKey={(u) => u.id} rows={users.data} loading={users.isLoading} onRowClick={setEditing} columns={[
          { header: 'Name', cell: (u) => <><b>{u.name}</b><div className="text-xs text-muted">{u.email}</div></> }, { header: 'Role', cell: (u) => <Badge>{label(u.role)}</Badge> }, { header: 'Branch', cell: (u) => u.branch?.name ?? 'All branches' },
          { header: 'Last sign-in', cell: (u) => dateTime(u.lastLoginAt) }, { header: 'Status', cell: (u) => (u.isActive ? <Badge tone="good">Active</Badge> : <Badge tone="bad">Disabled</Badge>) },
          { header: 'Email approval', cell: (u) => (u.emailApprovalEnabled ? <Badge tone="good">On</Badge> : settings.data?.loginApprovalRequiredRoles.includes(u.role) ? <Badge tone="good">Required</Badge> : <Badge>Off</Badge>) },
          { header: 'Security', align: 'right', cell: (u) => canManage(u) && (
            <span className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              <Button size="sm" variant="secondary" onClick={() => setResetting(u)}>Reset password</Button>
              <Button size="sm" variant="ghost" onClick={() => setChangingEmail(u)}>Change email</Button>
            </span>) }]} />
      </Panel>
      {editing && <UserForm user={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {resetting && <ResetPassword user={resetting} onClose={() => setResetting(null)} />}
      {changingEmail && <ChangeEmail user={changingEmail} onClose={() => setChangingEmail(null)} />}
    </>
  );
};
