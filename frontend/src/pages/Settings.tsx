import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BranchSelect } from '../components/BranchSelect';
import { Badge, Button, DataTable, ErrorNote, Input, Loading, PageHeader, Panel, Tabs, useToast } from '../components/ui';
import { api } from '../lib/api';
import { isDesktop } from '../lib/desktop';
import { label } from '../lib/format';
import { loadSettings, useBranches, usePage } from '../lib/queries';
import type { Register, Role, Settings as SettingsType } from '../lib/types';
import { DesktopSettings } from './DesktopSettings';
import { SheetsSettings } from './SheetsSettings';

const ROLES: Role[] = ['SUPER_ADMIN', 'MANAGER', 'CASHIER', 'STOCK_OFFICER', 'ACCOUNTANT', 'AUDITOR'];

const General = () => {
  const toast = useToast();
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['settings'], queryFn: loadSettings });
  const [draft, setS] = useState<SettingsType | null>(null);
  const s = draft ?? query.data ?? null;
  const save = useMutation({ mutationFn: (body: SettingsType) => api('/settings', { method: 'PUT', body }), onSuccess: () => { toast('success', 'Settings saved'); void client.invalidateQueries({ queryKey: ['settings'] }); } });
  if (!s) return <Loading />;
  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); save.mutate(s); }}>
      <Panel title="Receipt">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Store name" value={s.receipt.storeName} onChange={(e) => setS({ ...s, receipt: { ...s.receipt, storeName: e.target.value } })} />
          <Input label="Header line" value={s.receipt.header} onChange={(e) => setS({ ...s, receipt: { ...s.receipt, header: e.target.value } })} />
          <Input label="Currency code" maxLength={3} value={s.currency} onChange={(e) => setS({ ...s, currency: e.target.value.toUpperCase() })} hint="Three letters, e.g. UGX. Changing it does not convert existing amounts." />
          <Input label="Footer message" value={s.receipt.footer} onChange={(e) => setS({ ...s, receipt: { ...s.receipt, footer: e.target.value } })} className="sm:col-span-2" />
        </div>
      </Panel>
      <Panel title="Maximum discount by role (%)">
        <div className="grid gap-3 sm:grid-cols-3">
          {ROLES.map((r) => <Input key={r} label={label(r)} inputMode="decimal" value={s.discountLimitPercent[r]} onChange={(e) => setS({ ...s, discountLimitPercent: { ...s.discountLimitPercent, [r]: Number(e.target.value) || 0 } })} />)}
        </div>
        <p className="mt-2 text-sm text-muted">Discounts above a cashier’s limit need a manager’s credentials at the till.</p>
      </Panel>
      <Panel title="Stock and loyalty">
        <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={s.allowNegativeStock} onChange={(e) => setS({ ...s, allowNegativeStock: e.target.checked })} /> Allow selling items that are out of stock (stock goes negative)</label>
        <label className="mt-3 flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={s.loyalty.enabled} onChange={(e) => setS({ ...s, loyalty: { ...s.loyalty, enabled: e.target.checked } })} /> Award loyalty points to customers</label>
        {s.loyalty.enabled && <Input label={`${s.currency} spent per point`} inputMode="decimal" className="mt-3 max-w-xs" value={s.loyalty.unitAmount} onChange={(e) => setS({ ...s, loyalty: { ...s.loyalty, unitAmount: Number(e.target.value) || 1 } })} />}
        <Input label="Expiry alert window (days)" inputMode="numeric" className="mt-3 max-w-xs" value={s.expiryAlertDays} onChange={(e) => setS({ ...s, expiryAlertDays: Number(e.target.value) || 30 })} />
      </Panel>
      <div className="flex items-center gap-3"><Button type="submit" loading={save.isPending}>Save settings</Button><ErrorNote error={save.error} /></div>
    </form>
  );
};

const Branches = () => {
  const client = useQueryClient();
  const toast = useToast();
  const branches = useBranches();
  const [f, setF] = useState({ code: '', name: '' });
  const add = useMutation({ mutationFn: () => api('/branches', { method: 'POST', body: f }), onSuccess: () => { toast('success', 'Branch created'); setF({ code: '', name: '' }); void client.invalidateQueries({ queryKey: ['ref'] }); } });
  const toggle = useMutation({ mutationFn: (b: { id: string; isActive: boolean }) => api(`/branches/${b.id}`, { method: 'PATCH', body: { isActive: !b.isActive } }), onSuccess: () => void client.invalidateQueries({ queryKey: ['ref'] }) });
  return (
    <Panel className="!p-0">
      <div className="flex flex-wrap items-end gap-3 border-b border-line p-4">
        <Input label="Code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} className="w-32" hint="e.g. KLA2" />
        <Input label="Branch name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Button onClick={() => add.mutate()} disabled={f.code.length < 2 || !f.name} loading={add.isPending}>Add branch</Button>
        <ErrorNote error={add.error} />
      </div>
      <DataTable rowKey={(b) => b.id} rows={branches.data} loading={branches.isLoading} columns={[
        { header: 'Code', cell: (b) => <b>{b.code}</b> }, { header: 'Name', cell: (b) => b.name }, { header: 'Status', cell: (b) => (b.isActive ? <Badge tone="good">Active</Badge> : <Badge>Inactive</Badge>) },
        { header: '', cell: (b) => <Button size="sm" variant="secondary" onClick={() => toggle.mutate(b)}>{b.isActive ? 'Deactivate' : 'Activate'}</Button>, align: 'right' }]} />
    </Panel>
  );
};

const Registers = () => {
  const client = useQueryClient();
  const toast = useToast();
  const [branchId, setBranchId] = useState('');
  const [name, setName] = useState('');
  const list = usePage<Register>('registers', '/registers', { pageSize: 100, branchId: branchId || undefined });
  const add = useMutation({ mutationFn: () => api('/registers', { method: 'POST', body: { name, branchId: branchId || undefined } }), onSuccess: () => { toast('success', 'Register added'); setName(''); void client.invalidateQueries({ queryKey: ['registers'] }); } });
  return (
    <Panel className="!p-0">
      <div className="flex flex-wrap items-end gap-3 border-b border-line p-4">
        <BranchSelect value={branchId} onChange={setBranchId} />
        <Input label="Register name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Register 3" />
        <Button onClick={() => add.mutate()} disabled={!name} loading={add.isPending}>Add register</Button>
        <ErrorNote error={add.error} />
      </div>
      <DataTable rowKey={(r) => r.id} rows={list.data?.data} loading={list.isLoading} columns={[{ header: 'Register', cell: (r) => <b>{r.name}</b> }, { header: 'Status', cell: (r) => (r.isActive ? <Badge tone="good">Active</Badge> : <Badge>Inactive</Badge>) }]} />
    </Panel>
  );
};

export const Settings = () => {
  const [params] = useSearchParams();
  const [tab, setTab] = useState<'general' | 'branches' | 'registers' | 'sheets' | 'desktop'>(params.get('tab') === 'sheets' && isDesktop() ? 'sheets' : 'general');
  return (
    <>
      <PageHeader title="Settings" />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'general', label: 'General' }, { id: 'branches', label: 'Branches' }, { id: 'registers', label: 'Registers' }, ...(isDesktop() ? [{ id: 'sheets' as const, label: 'Google Sheets' }, { id: 'desktop' as const, label: 'Printer and backups' }] : [])]} />
      {tab === 'general' && <General />}
      {tab === 'branches' && <Branches />}
      {tab === 'registers' && <Registers />}
      {tab === 'sheets' && <SheetsSettings />}
      {tab === 'desktop' && <DesktopSettings />}
    </>
  );
};
