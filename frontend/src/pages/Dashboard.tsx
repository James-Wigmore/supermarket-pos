import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BranchSelect } from '../components/BranchSelect';
import { Badge, DataTable, ErrorNote, Loading, PageHeader, Panel, Stat } from '../components/ui';
import { api } from '../lib/api';
import { dateTime, fmtNum, label, money } from '../lib/format';

interface Dash {
  today: { transactions: number; revenue: number; items: number; grossProfit: number };
  payments: { method: string; amount: number }[]; trend: { day: string; revenue: number; transactions: number }[];
  stockValue: number; lowStockCount: number; outOfStockCount: number;
  expiry: { windowDays: number; expiringSoon: number; expired: number };
  lowStock: { id: string; name: string; quantity: number; minStock: number }[];
  recent: { id: string; receiptNo: string; total: number; soldAt: string; status: string; cashier: string }[];
  cashiers: { cashier: string; transactions: number; revenue: number }[];
  fastMoving: { name: string; sold: number }[]; slowMoving: { name: string; sold: number; stock: number }[];
}

const compact = (v: number) => new Intl.NumberFormat('en', { notation: 'compact' }).format(v);

export const Dashboard = () => {
  const [branchId, setBranchId] = useState('');
  const q = useQuery({ queryKey: ['dashboard', branchId], queryFn: () => api<Dash>('/dashboard', { query: { branchId: branchId || undefined } }), refetchInterval: 60_000 });
  const d = q.data;
  return (
    <>
      <PageHeader title="Dashboard" subtitle="Live figures from today’s trading"><BranchSelect value={branchId} onChange={setBranchId} /></PageHeader>
      <ErrorNote error={q.error} />
      {!d ? <Loading /> : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7">
            <Stat label="Revenue today" value={money(d.today.revenue)} />
            <Stat label="Gross profit" value={money(d.today.grossProfit)} />
            <Stat label="Transactions" value={fmtNum(d.today.transactions)} />
            <Stat label="Items sold" value={fmtNum(d.today.items)} />
            <Stat label="Stock value (at cost)" value={money(d.stockValue)} />
            <Stat label="Low / out of stock" value={`${d.lowStockCount} / ${d.outOfStockCount}`} tone={d.outOfStockCount ? 'bad' : d.lowStockCount ? 'warn' : undefined} />
            <Stat label={`Expiring in ${d.expiry.windowDays} days / expired`} value={`${d.expiry.expiringSoon} / ${d.expiry.expired}`} tone={d.expiry.expired ? 'bad' : d.expiry.expiringSoon ? 'warn' : undefined} hint="Batches still in stock" />
          </div>
          <div className="grid gap-5 xl:grid-cols-3">
            <Panel title="Sales, last 14 days" className="xl:col-span-2">
              <div className="h-64"><ResponsiveContainer><LineChart data={d.trend}><CartesianGrid stroke="#e0dccb" vertical={false} /><XAxis dataKey="day" tickFormatter={(v: string) => v.slice(5)} fontSize={12} /><YAxis tickFormatter={compact} fontSize={12} width={48} /><Tooltip formatter={(v) => money(v)} /><Line dataKey="revenue" stroke="#4b5e2a" strokeWidth={2.5} dot={false} name="Revenue" /></LineChart></ResponsiveContainer></div>
            </Panel>
            <Panel title="Payment methods today">
              {d.payments.length ? <div className="h-64"><ResponsiveContainer><BarChart data={d.payments.map((p) => ({ ...p, method: label(p.method) }))} layout="vertical"><XAxis type="number" tickFormatter={compact} fontSize={12} /><YAxis type="category" dataKey="method" width={100} fontSize={12} /><Tooltip formatter={(v) => money(v)} /><Bar dataKey="amount" fill="#e8762b" radius={3} name="Amount" /></BarChart></ResponsiveContainer></div> : <p className="py-16 text-center text-sm text-muted">No payments yet today.</p>}
            </Panel>
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <Panel title="Needs restocking" className="!p-0"><DataTable rowKey={(r) => r.id} rows={d.lowStock} empty={<p className="p-8 text-center text-sm text-muted">Every product is above its minimum.</p>} columns={[{ header: 'Product', cell: (r) => r.name }, { header: 'In stock', cell: (r) => <Badge tone={r.quantity <= 0 ? 'bad' : 'warn'}>{fmtNum(r.quantity)}</Badge>, align: 'right' }, { header: 'Minimum', cell: (r) => fmtNum(r.minStock), align: 'right' }]} /></Panel>
            <Panel title="Recent transactions" className="!p-0"><DataTable rowKey={(r) => r.id} rows={d.recent} empty={<p className="p-8 text-center text-sm text-muted">No sales yet.</p>} columns={[{ header: 'Receipt', cell: (r) => r.receiptNo }, { header: 'Cashier', cell: (r) => r.cashier }, { header: 'Time', cell: (r) => dateTime(r.soldAt) }, { header: 'Total', cell: (r) => <span className={r.status === 'VOIDED' ? 'line-through' : 'font-semibold'}>{money(r.total)}</span>, align: 'right' }]} /></Panel>
            <Panel title="Fast-moving (7 days)" className="!p-0"><DataTable rowKey={(r) => r.name} rows={d.fastMoving} empty={<p className="p-8 text-center text-sm text-muted">Not enough sales yet.</p>} columns={[{ header: 'Product', cell: (r) => r.name }, { header: 'Sold', cell: (r) => fmtNum(r.sold), align: 'right' }]} /></Panel>
            <Panel title="Slow-moving (30 days)" className="!p-0"><DataTable rowKey={(r) => r.name} rows={d.slowMoving} empty={<p className="p-8 text-center text-sm text-muted">Nothing is lingering on the shelves.</p>} columns={[{ header: 'Product', cell: (r) => r.name }, { header: 'Sold', cell: (r) => fmtNum(r.sold), align: 'right' }, { header: 'In stock', cell: (r) => fmtNum(r.stock), align: 'right' }]} /></Panel>
            <Panel title="Cashier performance today" className="!p-0 lg:col-span-2"><DataTable rowKey={(r) => r.cashier} rows={d.cashiers} empty={<p className="p-8 text-center text-sm text-muted">No cashier has sold anything today.</p>} columns={[{ header: 'Cashier', cell: (r) => r.cashier }, { header: 'Transactions', cell: (r) => r.transactions, align: 'right' }, { header: 'Revenue', cell: (r) => money(r.revenue), align: 'right' }]} /></Panel>
          </div>
        </div>
      )}
    </>
  );
};
