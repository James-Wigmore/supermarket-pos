import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { BranchSelect } from '../components/BranchSelect';
import { Button, DataTable, ErrorNote, Input, PageHeader, Panel, Select, useToast } from '../components/ui';
import { api, downloadFile } from '../lib/api';
import { date, endOfDay, fmtNum, isoDay, money, startOfDay } from '../lib/format';
import { errorMessage, useDebounced } from '../lib/hooks';

interface Column { key: string; label: string; type?: 'money' | 'number' | 'date' | 'text' }
interface Report { title: string; columns: Column[]; rows: Record<string, unknown>[] }

const REPORTS = [
  { group: 'Sales', items: [['sales', 'Sales summary']] },
  { group: 'Inventory', items: [['inventory-current', 'Current stock'], ['stock-movements', 'Stock movements'], ['damaged-stock', 'Damaged stock'], ['stock-valuation', 'Stock valuation'], ['low-stock', 'Low stock'], ['out-of-stock', 'Out of stock'], ['expiring', 'Expiring products'], ['fast-moving', 'Fast-moving products'], ['slow-moving', 'Slow-moving products']] },
  { group: 'Financial', items: [['financial', 'Revenue, cost and profit'], ['expenses', 'Expenses']] },
  { group: 'Cashier', items: [['cashier', 'Cashier performance']] },
  { group: 'Catalogue and purchasing', items: [['products', 'Products list'], ['purchases', 'Purchases']] },
] as const;

const GROUPS = ['day', 'week', 'month', 'product', 'category', 'cashier', 'branch', 'payment'];
const cell = (c: Column, v: unknown) => (c.type === 'money' ? money(v) : c.type === 'number' ? fmtNum(v) : c.type === 'date' ? date(v as string) : v == null ? '' : String(v));

export const Reports = () => {
  const [name, setName] = useState('sales');
  const [from, setFrom] = useState(() => isoDay(startOfDay(new Date(Date.now() - 29 * 864e5))));
  const [to, setTo] = useState(() => isoDay(new Date()));
  const [groupBy, setGroupBy] = useState('day');
  const [windowDays, setWindowDays] = useState('30');
  const [branchId, setBranchId] = useState('');
  const [reason, setReason] = useState('');
  const reasonFilter = useDebounced(reason.trim());
  const toast = useToast();
  const query = {
    from: startOfDay(new Date(`${from}T00:00`)).toISOString(), to: endOfDay(new Date(`${to}T00:00`)).toISOString(), branchId: branchId || undefined,
    groupBy: name === 'sales' ? groupBy : undefined, window: name === 'expiring' ? windowDays : undefined,
    reason: name === 'damaged-stock' ? reasonFilter || undefined : undefined,
  };
  const report = useQuery({ queryKey: ['report', name, query], queryFn: () => api<Report>(`/reports/${name}`, { query }) });
  const fail = (err: unknown) => toast('error', errorMessage(err));
  const download = (format: 'csv' | 'xlsx' | 'pdf') => void downloadFile(`/reports/${name}`, { ...query, format }, `${name}.${format}`).catch(fail);
  // Print opens the PDF version in its own window, ready for the printer.
  const print = () => void downloadFile(`/reports/${name}`, { ...query, format: 'pdf' }, null).catch(fail);
  const snapshot = ['inventory-current', 'stock-valuation', 'low-stock', 'out-of-stock', 'expiring'].includes(name);
  // Only columns that are meant to be added up get a total (never prices or the financial summary's mixed lines).
  const total = report.data?.columns.filter((c) => c.type === 'money' && ['revenue', 'profit', 'value', 'lossValue', 'total', 'amount'].includes(c.key) && report.data!.rows.length > 1).slice(-1)[0];

  return (
    <>
      <PageHeader title="Reports" subtitle="Run, review and export">
        <Button variant="secondary" onClick={print} disabled={!report.data}>Print</Button>
        {(['csv', 'xlsx', 'pdf'] as const).map((f) => <Button key={f} variant="secondary" onClick={() => download(f)} disabled={!report.data}>{f === 'xlsx' ? 'Excel' : f.toUpperCase()}</Button>)}
      </PageHeader>
      <Panel className="mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Select label="Report" value={name} onChange={(e) => setName(e.target.value)} className="lg:col-span-2">{REPORTS.map((g) => <optgroup key={g.group} label={g.group}>{g.items.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</optgroup>)}</Select>
          {!snapshot && <><Input label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /><Input label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></>}
          {name === 'damaged-stock' && <Input label="Reason contains" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. dropped, leak" />}
          {name === 'sales' && <Select label="Group by" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>{GROUPS.map((g) => <option key={g} value={g}>{g[0]!.toUpperCase() + g.slice(1)}</option>)}</Select>}
          {name === 'expiring' && <Select label="Expiring within" value={windowDays} onChange={(e) => setWindowDays(e.target.value)}><option value="expired">Already expired</option><option value="today">Today</option><option value="7">7 days</option><option value="30">30 days</option><option value="all">All batches</option></Select>}
          <div className="flex items-end"><BranchSelect value={branchId} onChange={setBranchId} /></div>
        </div>
      </Panel>
      <ErrorNote error={report.error} />
      {report.data && (
        <Panel title={report.data.title} className="!p-0" actions={<span className="text-sm text-muted">{report.data.rows.length} rows</span>}>
          <DataTable<Record<string, unknown>> rowKey={(r) => JSON.stringify(r)} rows={report.data.rows} loading={report.isLoading} empty={<p className="p-10 text-center text-muted">No data for this period.</p>}
            columns={report.data.columns.map((c) => ({ header: c.label, cell: (r) => cell(c, r[c.key]), align: c.type === 'text' || c.type === 'date' ? undefined : ('right' as const) }))} />
          {total && <p className="border-t border-line px-4 py-2 text-right text-sm font-semibold">{total.label} total: {money(report.data.rows.reduce((s, r) => s + Number(r[total.key] ?? 0), 0))}</p>}
        </Panel>
      )}
    </>
  );
};
