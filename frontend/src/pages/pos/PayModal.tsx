import { useState } from 'react';
import { Button, ErrorNote, Modal } from '../../components/ui';
import { settle, type PaymentRow } from '../../lib/cart';
import { amt, fmtNum, label, money } from '../../lib/format';
import type { PaymentMethod } from '../../lib/types';

const METHODS: { method: PaymentMethod; key: string }[] = [
  { method: 'CASH', key: '1' }, { method: 'MOBILE_MONEY', key: '2' }, { method: 'CARD', key: '3' }, { method: 'OTHER', key: '4' },
];
const NOTES = [1000, 5000, 10000, 20000, 50000];

interface Props {
  total: number;
  busy: boolean;
  error?: unknown;
  onClose: () => void;
  onConfirm: (payments: PaymentRow[]) => void;
}

/** Mounted only while paying, so every payment starts with a clean form. */
export const PayModal = ({ total, busy, error, onClose, onConfirm }: Props) => {
  const [rows, setRows] = useState<{ method: PaymentMethod; amount: string; reference: string }[]>([{ method: 'CASH', amount: '', reference: '' }]);

  const payments: PaymentRow[] = rows.map((r) => ({ method: r.method, amount: amt(r.amount) || 0, reference: r.reference || undefined })).filter((p) => p.amount > 0);
  const { tendered, change, remaining, valid } = settle(total, payments);
  const update = (index: number, patch: Partial<(typeof rows)[number]>) => setRows((list) => list.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const fillRemaining = (index: number) => update(index, { amount: String(Math.max(0, total - payments.reduce((s, p, i) => (i === index ? s : s + p.amount), 0))) });

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && valid && !busy) {
      e.preventDefault();
      onConfirm(payments);
    }
  };

  return (
    <Modal open onClose={onClose} title="Take payment" width="md"
      footer={<><Button variant="secondary" onClick={onClose}>Back to cart</Button><Button size="lg" onClick={() => onConfirm(payments)} disabled={!valid} loading={busy}>Complete sale</Button></>}>
      <div onKeyDown={onKey} className="space-y-4">
        <div className="rounded-panel bg-tape p-4 text-white">
          <p className="text-sm text-white/70">Amount due</p>
          <p className="text-4xl font-bold">{money(total)}</p>
        </div>

        {rows.map((row, i) => (
          <div key={i} className="space-y-2 rounded-panel border border-line p-3">
            <div className="flex flex-wrap gap-1.5">
              {METHODS.map(({ method, key }) => (
                <button key={method} type="button" onClick={() => update(i, { method })} aria-pressed={row.method === method}
                  className={`rounded-field border px-3 py-1.5 text-sm font-semibold ${row.method === method ? 'border-brand bg-brand text-white' : 'border-line hover:bg-paper'}`}>
                  {label(method)} <span className="ml-1 text-xs opacity-60">{key}</span>
                </button>
              ))}
              {rows.length > 1 && <button type="button" onClick={() => setRows((l) => l.filter((_, x) => x !== i))} className="ml-auto text-sm text-danger">Remove</button>}
            </div>
            <div className="flex gap-2">
              <input aria-label="Amount tendered" inputMode="decimal" autoFocus={i === 0} value={row.amount} onChange={(e) => update(i, { amount: e.target.value.replace(/[^\d.]/g, '') })}
                placeholder="Amount" className="w-full rounded-field border border-line px-3 py-2.5 text-xl font-bold" />
              <Button variant="secondary" onClick={() => fillRemaining(i)}>Exact</Button>
            </div>
            {row.method === 'CASH' && (
              <div className="flex flex-wrap gap-1.5">
                {NOTES.map((n) => <button key={n} type="button" onClick={() => update(i, { amount: String(n) })} className="rounded-field border border-line px-2.5 py-1 text-xs font-medium hover:bg-paper">{fmtNum(n)}</button>)}
              </div>
            )}
            {row.method !== 'CASH' && (
              <input aria-label="Payment reference" value={row.reference} onChange={(e) => update(i, { reference: e.target.value })} placeholder="Reference / transaction ID (optional)" className="w-full rounded-field border border-line px-3 py-2 text-sm" />
            )}
          </div>
        ))}
        <Button variant="ghost" size="sm" onClick={() => setRows((l) => [...l, { method: 'MOBILE_MONEY', amount: '', reference: '' }])}>Split payment</Button>

        <div className="grid grid-cols-2 gap-3 text-center">
          <div className="rounded-panel border border-line p-3"><p className="text-sm text-muted">Tendered</p><p className="text-xl font-bold">{money(tendered)}</p></div>
          <div className={`rounded-panel p-3 ${remaining > 0 ? 'bg-danger-soft text-danger' : 'bg-brand-soft text-brand-dark'}`}>
            <p className="text-sm">{remaining > 0 ? 'Still to pay' : 'Change'}</p>
            <p className="text-3xl font-bold">{money(remaining > 0 ? remaining : change)}</p>
          </div>
        </div>
        {tendered > total && change > 0 && !valid && <p className="text-sm text-danger">Change can only be given from cash.</p>}
        <ErrorNote error={error} />
      </div>
    </Modal>
  );
};
