import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../lib/api';
import { useDebounced } from '../../lib/hooks';
import type { Customer, Page } from '../../lib/types';

/** Optional: attach a customer (by name or phone) so purchase history and loyalty points build up. Anonymous stays the default. */
export const CustomerPicker = ({ customer, online, onChange }: { customer: Customer | null; online: boolean; onChange: (customer: Customer | null) => void }) => {
  const [text, setText] = useState('');
  const q = useDebounced(text.trim());
  const found = useQuery({
    queryKey: ['pos-customers', q],
    queryFn: () => api<Page<Customer>>('/customers', { query: { search: q, pageSize: 5 } }),
    enabled: online && q.length >= 2 && !customer,
  });

  if (customer) {
    return (
      <div className="mb-3 flex items-center justify-between rounded-field bg-white/10 px-3 py-2 text-sm">
        <span><b>{customer.name}</b>{customer.phone && <span className="text-white/70"> · {customer.phone}</span>} · {customer.loyaltyPoints} pts</span>
        <button type="button" onClick={() => { onChange(null); setText(''); }} className="text-white/70 hover:text-white" aria-label="Remove customer">✕</button>
      </div>
    );
  }
  return (
    <div className="relative mb-3">
      <input aria-label="Customer (optional)" value={text} disabled={!online} onChange={(e) => setText(e.target.value)}
        placeholder={online ? 'Customer name or phone (optional)' : 'Customer lookup needs a connection'}
        className="w-full rounded-field border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-white/50 disabled:opacity-50" />
      {q.length >= 2 && found.data && (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-field bg-white text-ink shadow-xl">
          {found.data.data.length === 0 && <li className="px-3 py-2 text-sm text-muted">No customer found</li>}
          {found.data.data.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => { onChange(c); setText(''); }} className="flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-brand-soft">
                <span className="font-medium">{c.name}</span><span className="text-muted">{c.phone ?? ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
