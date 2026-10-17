import { useState } from 'react';
import { BranchSelect } from '../components/BranchSelect';
import { Badge, DataTable, Modal, PageHeader, Pagination, Panel, inputCls } from '../components/ui';
import { dateTime, label } from '../lib/format';
import { usePage } from '../lib/queries';

interface Entry { id: string; action: string; entity: string; entityId: string | null; userName: string | null; ip: string | null; userAgent: string | null; createdAt: string; before: unknown; after: unknown }

const ACTIONS = ['LOGIN', 'LOGOUT', 'LOGIN_FAILED', 'PRODUCT_CREATE', 'PRODUCT_UPDATE', 'PRICE_CHANGE', 'STOCK_ADJUST', 'STOCK_RECEIVE', 'SALE', 'REFUND', 'DISCOUNT', 'VOID', 'USER_CREATE', 'PERMISSION_CHANGE', 'MANAGER_APPROVAL', 'SESSION_CLOSE', 'PASSWORD_CHANGE', 'PASSWORD_RESET', 'USER_EMAIL_CHANGE', 'EMAIL_APPROVAL_ENABLED', 'EMAIL_APPROVAL_DISABLED', 'EMAIL_APPROVAL_OFF', 'LOGIN_APPROVAL_REQUESTED', 'LOGIN_APPROVAL_APPROVED', 'LOGIN_APPROVAL_REJECTED', 'LOGIN_APPROVAL_EXPIRED', 'LOGIN_APPROVAL_CANCELLED', 'LOGIN_APPROVAL_EMAIL_FAILED', 'LOGIN_APPROVAL_INVALID_LINK', 'LOGIN_APPROVAL_POLICY_CHANGE', 'ACCOUNT_RECOVERY'];

export const Audit = () => {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [branchId, setBranchId] = useState('');
  const [open, setOpen] = useState<Entry | null>(null);
  const list = usePage<Entry>('audit', '/audit-logs', { page, pageSize: 30, action: action || undefined, branchId: branchId || undefined });
  return (
    <>
      <PageHeader title="Audit log" subtitle="A permanent record of important actions. Entries cannot be edited or deleted.">
        <select aria-label="Action" className={`${inputCls} !w-auto`} value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}><option value="">All actions</option>{ACTIONS.map((a) => <option key={a} value={a}>{label(a)}</option>)}</select>
        <BranchSelect value={branchId} onChange={setBranchId} />
      </PageHeader>
      <Panel className="!p-0">
        <DataTable rowKey={(e) => e.id} rows={list.data?.data} loading={list.isLoading} onRowClick={setOpen} empty={<p className="p-10 text-center text-muted">No entries.</p>} columns={[
          { header: 'When', cell: (e) => dateTime(e.createdAt) }, { header: 'User', cell: (e) => e.userName ?? '—' }, { header: 'Action', cell: (e) => <Badge>{label(e.action)}</Badge> },
          { header: 'Entity', cell: (e) => e.entity }, { header: 'IP', cell: (e) => e.ip ?? '—' }]} />
        <Pagination meta={list.data?.meta} onPage={setPage} />
      </Panel>
      <Modal open={Boolean(open)} onClose={() => setOpen(null)} title={open ? label(open.action) : ''} width="lg">
        {open && (
          <div className="space-y-3 text-sm">
            <p className="text-muted">{dateTime(open.createdAt)} · {open.userName ?? 'System'} · {open.ip ?? 'no IP'}</p>
            {open.userAgent && <p className="truncate text-xs text-muted">{open.userAgent}</p>}
            {open.before != null && <div><p className="mb-1 font-semibold">Before</p><pre className="overflow-x-auto rounded-field bg-paper p-3 text-xs">{JSON.stringify(open.before, null, 2)}</pre></div>}
            {open.after != null && <div><p className="mb-1 font-semibold">After</p><pre className="overflow-x-auto rounded-field bg-paper p-3 text-xs">{JSON.stringify(open.after, null, 2)}</pre></div>}
          </div>
        )}
      </Modal>
    </>
  );
};
