import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Button, Confirm, DataTable, ErrorNote, Input, Modal, PageHeader, Panel, Select, useToast } from '../components/ui';
import { api } from '../lib/api';
import { date, fmtNum, label, money, num, currencyCode } from '../lib/format';
import { useDebounced } from '../lib/hooks';
import { usePage } from '../lib/queries';
import type { Product, Promotion } from '../lib/types';

const TYPES = { PERCENT: 'Percentage off', FIXED: 'Fixed amount off each', PROMO_PRICE: 'Promotional price', BULK: 'Bulk price', BOGO: 'Buy one get one' } as const;

const describe = (p: Promotion) => ({
  PERCENT: `${fmtNum(p.value)}% off`, FIXED: `${money(p.value)} off each`, PROMO_PRICE: `Price ${money(p.value)}`,
  BULK: `${money(p.value)} each from ${fmtNum(p.minQty)}`, BOGO: `Buy ${p.buyQty} get ${p.getQty} free`,
})[p.type];

const initial = (p: Promotion | null) => ({
  name: p?.name ?? '', type: (p?.type ?? 'PERCENT') as Promotion['type'], value: p ? String(num(p.value)) : '', minQty: p ? String(num(p.minQty)) : '1',
  buyQty: String(p?.buyQty ?? 1), getQty: String(p?.getQty ?? 1), startsAt: (p ? new Date(p.startsAt) : new Date()).toISOString().slice(0, 16),
  endsAt: p?.endsAt ? new Date(p.endsAt).toISOString().slice(0, 16) : '',
});

const PromotionForm = ({ promotion, onClose }: { promotion: Promotion | null; onClose: () => void }) => {
  const client = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState(initial(promotion));
  const [search, setSearch] = useState('');
  const [product, setProduct] = useState<Pick<Product, 'id' | 'name'> | null>(promotion?.productId ? { id: promotion.productId, name: promotion.product?.name ?? '' } : null);
  const q = useDebounced(search);
  const found = useQuery({ queryKey: ['promo-product', q], queryFn: () => api<{ data: Product[] }>('/products', { query: { search: q, pageSize: 6 } }), enabled: q.length >= 2 && !product });
  const save = useMutation({
    mutationFn: () => api(promotion ? `/promotions/${promotion.id}` : '/promotions', { method: promotion ? 'PATCH' : 'POST', body: { name: f.name, type: f.type, value: Number(f.value || 0), minQty: Number(f.minQty), buyQty: Number(f.buyQty), getQty: Number(f.getQty), productId: product?.id ?? null, startsAt: new Date(f.startsAt).toISOString(), endsAt: f.endsAt ? new Date(f.endsAt).toISOString() : null } }),
    onSuccess: () => { toast('success', promotion ? 'Promotion updated' : 'Promotion created'); void client.invalidateQueries({ queryKey: ['promotions'] }); onClose(); },
  });
  return (
    <Modal open onClose={onClose} title={promotion ? 'Edit promotion' : 'New promotion'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => save.mutate()} loading={save.isPending} disabled={!f.name}>{promotion ? 'Save changes' : 'Create promotion'}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="sm:col-span-2" autoFocus />
        <Select label="Type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as Promotion['type'] })}>{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        {f.type !== 'BOGO' && <Input label={f.type === 'PERCENT' ? 'Percent' : `Amount (${currencyCode()})`} inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />}
        {f.type === 'BULK' && <Input label="Minimum quantity" inputMode="decimal" value={f.minQty} onChange={(e) => setF({ ...f, minQty: e.target.value })} />}
        {f.type === 'BOGO' && <><Input label="Customer buys" inputMode="numeric" value={f.buyQty} onChange={(e) => setF({ ...f, buyQty: e.target.value })} /><Input label="Customer gets free" inputMode="numeric" value={f.getQty} onChange={(e) => setF({ ...f, getQty: e.target.value })} /></>}
        <Input label="Starts" type="datetime-local" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} />
        <Input label="Ends (optional)" type="datetime-local" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} />
        <div className="relative sm:col-span-2">
          <Input label="Product" value={product ? product.name : search} onChange={(e) => { setProduct(null); setSearch(e.target.value); }} hint="Leave empty to apply to every product" />
          {found.data && !product && q.length >= 2 && <ul className="absolute z-10 mt-1 w-full rounded-panel border border-line bg-white shadow-lg">{found.data.data.map((p) => <li key={p.id}><button type="button" className="w-full px-3 py-2 text-left hover:bg-brand-soft" onClick={() => setProduct(p)}>{p.name}</button></li>)}</ul>}
        </div>
      </div>
      <div className="mt-3"><ErrorNote error={save.error} /></div>
    </Modal>
  );
};

export const Promotions = () => {
  const client = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<Promotion | null | 'new'>(null);
  const [deleting, setDeleting] = useState<Promotion | null>(null);
  const list = usePage<Promotion>('promotions', '/promotions', { pageSize: 100 });
  const toggle = useMutation({ mutationFn: (p: Promotion) => api(`/promotions/${p.id}`, { method: 'PATCH', body: { isActive: !p.isActive } }), onSuccess: () => void client.invalidateQueries({ queryKey: ['promotions'] }), onError: (e) => toast('error', e.message) });
  const del = useMutation({
    mutationFn: (id: string) => api(`/promotions/${id}`, { method: 'DELETE' }),
    onSuccess: () => { toast('success', 'Promotion deleted'); void client.invalidateQueries({ queryKey: ['promotions'] }); },
    onError: (e) => toast('error', e.message),
    onSettled: () => setDeleting(null),
  });
  const live = (p: Promotion) => p.isActive && new Date(p.startsAt) <= new Date() && (!p.endsAt || new Date(p.endsAt) >= new Date());
  return (
    <>
      <PageHeader title="Promotions" subtitle="Discounts the POS applies automatically"><Button onClick={() => setEditing('new')}>New promotion</Button></PageHeader>
      <Panel className="!p-0">
        <DataTable rowKey={(p) => p.id} rows={list.data?.data} loading={list.isLoading} empty={<p className="p-10 text-center text-muted">No promotions yet.</p>} columns={[
          { header: 'Name', cell: (p) => <b>{p.name}</b> }, { header: 'Offer', cell: (p) => `${label(p.type)}: ${describe(p)}` }, { header: 'Applies to', cell: (p) => p.product?.name ?? 'All products' },
          { header: 'Period', cell: (p) => `${date(p.startsAt)} – ${p.endsAt ? date(p.endsAt) : 'open'}` }, { header: 'Status', cell: (p) => (live(p) ? <Badge tone="good">Live</Badge> : <Badge>Inactive</Badge>) },
          { header: '', align: 'right', cell: (p) => <span className="flex justify-end gap-1"><Button size="sm" variant="secondary" onClick={() => toggle.mutate(p)}>{p.isActive ? 'Turn off' : 'Turn on'}</Button><Button size="sm" variant="secondary" onClick={() => setEditing(p)}>Edit</Button><Button size="sm" variant="ghost" onClick={() => setDeleting(p)}>Delete</Button></span> }]} />
      </Panel>
      {editing && <PromotionForm promotion={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <Confirm open={Boolean(deleting)} danger title="Delete promotion?" message={`“${deleting?.name}” will stop applying at the till. Past sales are not affected.`} confirmLabel="Delete" onCancel={() => setDeleting(null)} onConfirm={() => deleting && del.mutate(deleting.id)} loading={del.isPending} />
    </>
  );
};
