import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BranchSelect } from '../components/BranchSelect';
import { Badge, Button, DataTable, ErrorNote, Input, Modal, PageHeader, Pagination, Panel, Stat, Textarea, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateTime, money, num, currencyCode } from '../lib/format';
import { usePage } from '../lib/queries';
import { useSync } from '../lib/sync';
import type { Session } from '../lib/types';

interface Summary {
  session: Session; salesCount: number; salesTotal: string; discounts: string; cashSales: string; mobileMoney: string; card: string; other: string;
  refunds: string; cashRefunds: string; voidsCount: number; voidsTotal: string; expectedCash: string;
}

const SummaryGrid = ({ s }: { s: Summary }) => (
  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
    <Stat label="Sales" value={s.salesCount} hint={money(s.salesTotal)} />
    <Stat label="Cash sales" value={money(s.cashSales)} />
    <Stat label="Mobile money" value={money(s.mobileMoney)} />
    <Stat label="Card" value={money(s.card)} />
    <Stat label="Refunds" value={money(s.refunds)} />
    <Stat label="Discounts" value={money(s.discounts)} />
    <Stat label="Voids" value={s.voidsCount} hint={money(s.voidsTotal)} />
    <Stat label="Expected cash in drawer" value={money(s.expectedCash)} hint={`Opening ${money(s.session.openingCash)}`} />
  </div>
);

const CloseShift = ({ session }: { session: Session }) => {
  const client = useQueryClient();
  const toast = useToast();
  const [actual, setActual] = useState('');
  const [notes, setNotes] = useState('');
  const [confirming, setConfirming] = useState(false);
  const { pending, failed, syncNow, syncing } = useSync();
  const unsent = pending + failed;
  const summary = useQuery({ queryKey: ['shift-summary', session.id], queryFn: () => api<Summary>(`/sessions/${session.id}/summary`) });
  const close = useMutation({
    mutationFn: () => api<Session>(`/sessions/${session.id}/close`, { method: 'POST', body: { actualCash: Number(actual), notes: notes || undefined } }),
    onSuccess: (closed) => {
      const diff = num(closed.difference);
      toast('success', diff === 0 ? 'Shift closed. Cash balances.' : `Shift closed with a ${diff < 0 ? 'shortage' : 'surplus'} of ${money(Math.abs(diff))}`);
      localStorage.removeItem('pos.shift');
      setConfirming(false);
      void client.invalidateQueries();
    },
  });
  const expected = num(summary.data?.expectedCash);
  const takings = expected - num(session.openingCash);
  const diff = actual === '' ? null : num(actual) - expected;
  return (
    <Panel title={`Current shift · ${session.register?.name ?? ''}`} actions={<Link className="text-sm font-semibold text-brand" to="/pos">Back to POS</Link>}>
      <p className="mb-4 text-sm text-muted">Opened {dateTime(session.openedAt)}</p>
      {summary.data && <SummaryGrid s={summary.data} />}
      <div className="mt-6 grid max-w-xl gap-3">
        <div className="rounded-panel border border-line bg-brand-soft px-4 py-3">
          <p className="text-sm text-muted">Expected total in drawer ({currencyCode()})</p>
          <p className="text-3xl font-bold text-brand-dark" data-testid="expected-total">{summary.data ? money(expected) : '…'}</p>
          <p className="text-xs text-muted">Opening {money(session.openingCash)} + cash from this shift {money(takings)}</p>
        </div>
        <Input label={`Total counted in the drawer (${currencyCode()})`} inputMode="decimal" value={actual} onChange={(e) => setActual(e.target.value)} />
        {diff !== null && <p className={`rounded-field px-3 py-2 text-sm font-semibold ${diff === 0 ? 'bg-brand-soft text-brand-dark' : 'bg-warn-soft text-warn'}`}>{diff === 0 ? 'Cash balances.' : `${diff < 0 ? 'Shortage' : 'Surplus'}: ${money(Math.abs(diff))}`}</p>}
        {unsent > 0 && (
          <div role="alert" className="rounded-field bg-warn-soft px-3 py-2 text-sm text-warn">
            {unsent} offline {unsent === 1 ? 'sale has' : 'sales have'} not reached the server yet{failed > 0 ? ` (${failed} failed, check the sync status)` : ''}. Upload {unsent === 1 ? 'it' : 'them'} before closing so the expected total is right.
            <div className="mt-2"><Button size="sm" variant="secondary" onClick={() => void syncNow()} loading={syncing}>Sync now</Button></div>
          </div>
        )}
        <Textarea label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div><Button onClick={() => setConfirming(true)} disabled={actual === '' || !summary.data || unsent > 0}>Close shift</Button></div>
      </div>
      <Modal open={confirming} onClose={() => setConfirming(false)} title="Close this shift?" width="sm" footer={<><Button variant="secondary" onClick={() => setConfirming(false)}>Not yet</Button><Button onClick={() => close.mutate()} loading={close.isPending}>Close shift</Button></>}>
        <p className="text-sm">You will not be able to sell on this shift afterwards. Counted cash: <b>{money(actual)}</b>, expected <b>{money(expected)}</b>.</p>
        <div className="mt-3"><ErrorNote error={close.error} /></div>
      </Modal>
    </Panel>
  );
};

export const Shifts = () => {
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const [branchId, setBranchId] = useState('');
  const current = useQuery({ queryKey: ['session'], queryFn: () => api<Session | null>('/sessions/current') });
  const list = usePage<Session>('shifts', '/sessions', { page, pageSize: 20, branchId: branchId || undefined });
  const [viewing, setViewing] = useState<string | null>(null);
  const detail = useQuery({ queryKey: ['shift-summary', viewing], queryFn: () => api<Summary>(`/sessions/${viewing}/summary`), enabled: Boolean(viewing) });
  return (
    <>
      <PageHeader title="Shifts" subtitle="Open, close and review cash drawers">{can('session:read-all') && <BranchSelect value={branchId} onChange={setBranchId} />}</PageHeader>
      {current.data && <div className="mb-5"><CloseShift session={current.data} /></div>}
      <Panel title="History" className="!p-0" >
        <DataTable rowKey={(s) => s.id} rows={list.data?.data} loading={list.isLoading} onRowClick={(s) => setViewing(s.id)} empty={<p className="p-10 text-center text-muted">No shifts yet.</p>} columns={[
          { header: 'Cashier', cell: (s) => s.cashierName ?? '—' }, { header: 'Register', cell: (s) => s.register?.name ?? '—' }, { header: 'Opened', cell: (s) => dateTime(s.openedAt) },
          { header: 'Status', cell: (s) => (s.status === 'OPEN' ? <Badge tone="warn">Open</Badge> : <Badge>Closed</Badge>) },
          { header: 'Expected', cell: (s) => (s.expectedCash == null ? '—' : money(s.expectedCash)), align: 'right' }, { header: 'Counted', cell: (s) => (s.actualCash == null ? '—' : money(s.actualCash)), align: 'right' },
          { header: 'Variance', cell: (s) => (s.difference == null ? '—' : <span className={num(s.difference) === 0 ? '' : 'font-semibold text-danger'}>{money(s.difference)}</span>), align: 'right' }]} />
        <Pagination meta={list.data?.meta} onPage={setPage} />
      </Panel>
      <Modal open={Boolean(viewing)} onClose={() => setViewing(null)} title="Shift summary" width="lg">{detail.data && <SummaryGrid s={detail.data} />}</Modal>
    </>
  );
};
