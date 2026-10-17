import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApproval } from '../../components/ApprovalDialog';
import { ReceiptModal } from '../../components/Receipt';
import { Badge, Button, Confirm, Empty, Loading, Modal, useToast } from '../../components/ui';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { addToCart, lineDiscount, localTotals, parseScan, toCartItem, toSaleItems, type CartItem, type PaymentRow } from '../../lib/cart';
import { dateTime, fmtNum, money, num, uuid, currencyCode } from '../../lib/format';
import { errorMessage, useDebounced } from '../../lib/hooks';
import { productCache, queue } from '../../lib/offline';
import { useSync } from '../../lib/sync';
import type { Customer, LookupProduct, LookupResult, Page, Product, Receipt, Sale, Session } from '../../lib/types';
import { CustomerPicker } from './CustomerPicker';
import { OpenShift } from './OpenShift';
import { PayModal } from './PayModal';

interface Quote { total: string; subtotal: string; discountTotal: string; lines: { productId: string; promoDiscount: string; lineTotal: string }[] }
interface Held { id: string; label: string | null; createdAt: string; payload: { items: CartItem[] } }

const lookupCode = async (code: string): Promise<LookupProduct | null> => {
  try {
    const result = await api<LookupResult>(`/products/lookup/${encodeURIComponent(code)}`);
    if (result.source !== 'internal') return null;
    void productCache.put(result.product);
    return result.product;
  } catch (err) {
    if (err instanceof ApiError && err.isNetwork) return (await productCache.byCode(code)) ?? null;
    throw err;
  }
};

const searchProducts = async (text: string): Promise<(Product | LookupProduct)[]> => {
  try {
    return (await api<Page<Product>>('/products', { query: { search: text, isActive: true, pageSize: 8 } })).data;
  } catch (err) {
    if (err instanceof ApiError && err.isNetwork) return productCache.search(text);
    throw err;
  }
};

const offlineReceipt = (cart: CartItem[], payments: PaymentRow[], clientId: string, cashier: string, storeName: string): Receipt => {
  const totals = localTotals(cart);
  const tendered = payments.reduce((s, p) => s + p.amount, 0);
  const cash = payments.filter((p) => p.method === 'CASH').reduce((s, p) => s + p.amount, 0);
  const change = Math.min(cash, Math.max(0, tendered - totals.total));
  let owed = change;
  const recorded = payments.map((p) => {
    const cut = p.method === 'CASH' ? Math.min(owed, p.amount) : 0;
    owed -= cut;
    return { method: p.method, amount: p.amount - cut };
  }).filter((p) => p.amount > 0);
  const sale: Sale = {
    id: clientId, receiptNo: `PENDING-${clientId.slice(0, 8).toUpperCase()}`, status: 'COMPLETED', subtotal: totals.subtotal, discountTotal: totals.discount,
    taxTotal: 0, total: totals.total, changeGiven: change, soldAt: new Date().toISOString(), offline: true, cashierName: cashier, payments: recorded,
    items: cart.map((l, i) => ({ id: String(i), productId: l.productId, name: l.name, quantity: l.quantity, returnedQty: 0, unitPrice: l.unitPrice ?? l.price, discount: lineDiscount(l), lineTotal: l.quantity * (l.unitPrice ?? l.price) - lineDiscount(l) })),
  };
  return { sale, store: { storeName, header: '', footer: 'Offline receipt, final receipt follows after sync' } };
};

const Register = ({ session }: { session: Session }) => {
  const { session: auth, can } = useAuth();
  const { online } = useSync();
  const toast = useToast();
  const client = useQueryClient();
  const { run, dialog } = useApproval();
  const scanRef = useRef<HTMLInputElement>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [selected, setSelected] = useState(0);
  const [scan, setScan] = useState('');
  const [matches, setMatches] = useState<(Product | LookupProduct)[]>([]);
  const [paying, setPaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [payError, setPayError] = useState<unknown>();
  const [receipt, setReceipt] = useState<{ data: Receipt; id?: string; queued?: boolean } | null>(null);
  const [clearing, setClearing] = useState(false);
  const [heldOpen, setHeldOpen] = useState(false);
  const clientId = useRef(uuid());
  const debounced = useDebounced(scan, 250);

  const focusScan = useCallback(() => setTimeout(() => scanRef.current?.focus(), 0), []);
  const local = useMemo(() => localTotals(cart), [cart]);
  const quoteKey = JSON.stringify(toSaleItems(cart));
  const quote = useQuery({
    queryKey: ['quote', quoteKey],
    queryFn: () => api<Quote>('/sales/quote', { method: 'POST', body: { items: toSaleItems(cart) } }),
    enabled: online && cart.length > 0,
    placeholderData: keepPreviousData,
    retry: false,
  });
  const fresh = online && quote.data && !quote.isPlaceholderData;
  const totals = fresh ? { subtotal: num(quote.data!.subtotal), discount: num(quote.data!.discountTotal), total: num(quote.data!.total) } : local;
  const lineTotal = (l: CartItem) => num(quote.data?.lines.find((q) => q.productId === l.productId)?.lineTotal ?? l.quantity * (l.unitPrice ?? l.price) - lineDiscount(l));
  const held = useQuery({ queryKey: ['held'], queryFn: () => api<Held[]>('/sales/held'), enabled: heldOpen && online });

  const addProduct = useCallback((p: Product | LookupProduct, quantity = 1) => {
    setCart((c) => addToCart(c, toCartItem(p, quantity)));
    setSelected(0);
    setScan('');
    setMatches([]);
    focusScan();
  }, [focusScan]);

  const searchable = debounced.length >= 2 && !/^\d+(\.\d+)?\*/.test(debounced) && !/^\d{6,}$/.test(debounced);
  const shown = searchable ? matches : [];

  useEffect(() => {
    if (!searchable) return;
    let cancelled = false;
    searchProducts(debounced).then((r) => !cancelled && setMatches(r)).catch(() => undefined);
    return () => { cancelled = true; };
  }, [debounced, searchable]);

  const submitScan = async () => {
    const { quantity, code } = parseScan(scan);
    if (!code) return;
    try {
      const product = await lookupCode(code);
      if (product) return addProduct(product, quantity);
      if (matches.length === 1 && matches[0]) return addProduct(matches[0], quantity);
      toast('error', `No product with barcode ${code}. Ask the stock officer to add it.`);
      setScan('');
    } catch (err) {
      toast('error', errorMessage(err));
    }
  };

  const setLine = (index: number, patch: Partial<CartItem>) => setCart((c) => c.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  const removeLine = (index: number) => { setCart((c) => c.filter((_, i) => i !== index)); setSelected(0); focusScan(); };
  const reset = () => { setCart([]); setCustomer(null); setScan(''); setPayError(undefined); clientId.current = uuid(); focusScan(); };

  const complete = async (payments: PaymentRow[]) => {
    setBusy(true);
    setPayError(undefined);
    const body = { clientId: clientId.current, sessionId: session.id, customerId: customer?.id, items: toSaleItems(cart), payments };
    try {
      const sale = await run('This sale uses a price or discount above your limit.', (approval) => api<Sale>('/sales', { method: 'POST', body: { ...body, approval } }));
      const data = await api<Receipt>(`/sales/${sale.id}/receipt`);
      setPaying(false);
      setReceipt({ data, id: sale.id });
      reset();
      void client.invalidateQueries({ queryKey: ['held'] });
    } catch (err) {
      if (err instanceof ApiError && err.isNetwork) {
        const data = offlineReceipt(cart, payments, clientId.current, auth?.user.name ?? '', 'Supermarket');
        await queue.add({ clientId: clientId.current, body: { ...body, offline: true, soldAt: new Date().toISOString() }, receipt: data.sale, createdAt: Date.now(), status: 'pending' });
        setPaying(false);
        setReceipt({ data, queued: true });
        reset();
      } else setPayError(err);
    } finally {
      setBusy(false);
    }
  };

  const hold = async () => {
    if (!cart.length) return;
    if (!online) return toast('error', 'Holding a sale needs a connection. Finish this sale or wait until you are back online.');
    try {
      await api('/sales/held', { method: 'POST', body: { payload: { items: cart } } });
      toast('success', 'Sale held');
      reset();
    } catch (err) { toast('error', errorMessage(err)); }
  };

  const resume = async (id: string) => {
    if (cart.length) return toast('error', 'Finish or hold the current sale first.');
    try {
      const h = await api<Held>(`/sales/held/${id}/resume`, { method: 'POST' });
      setCart(h.payload.items);
      setHeldOpen(false);
      focusScan();
    } catch (err) { toast('error', errorMessage(err)); }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (paying || receipt || heldOpen || clearing) return;
      if (e.key === 'F2') { e.preventDefault(); scanRef.current?.focus(); }
      if (e.key === 'F4' && cart.length) { e.preventDefault(); setPaying(true); }
      if (e.key === 'F8') { e.preventDefault(); void hold(); }
      if (e.key === 'F9') { e.preventDefault(); setHeldOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const onScanKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); void submitScan(); }
    if (e.key === 'ArrowDown' && cart.length) { e.preventDefault(); setSelected((s) => Math.min(cart.length - 1, s + 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((s) => Math.max(0, s - 1)); }
    if (e.key === '+' && cart[selected]) { e.preventDefault(); setLine(selected, { quantity: cart[selected]!.quantity + 1 }); }
    if (e.key === '-' && cart[selected]) { e.preventDefault(); const q = cart[selected]!.quantity - 1; if (q > 0) setLine(selected, { quantity: q }); else removeLine(selected); }
    if (e.key === 'Delete' && cart[selected]) { e.preventDefault(); removeLine(selected); }
    if (e.key === 'Escape') { setScan(''); setMatches([]); }
  };

  const itemCount = cart.reduce((s, l) => s + l.quantity, 0);

  return (
    <div className="grid h-full grid-cols-1 lg:grid-cols-[1fr_380px]">
      <section className="flex min-h-0 flex-col">
        <div className="relative border-b border-line bg-white p-3">
          <div className="flex items-center gap-3">
            <input ref={scanRef} autoFocus value={scan} onChange={(e) => setScan(e.target.value)} onKeyDown={onScanKey} onBlur={() => !paying && !receipt && !heldOpen && !clearing && setTimeout(() => document.activeElement === document.body && scanRef.current?.focus(), 150)}
              aria-label="Scan barcode or search product" placeholder="Scan barcode or type a product name   (2*barcode sets quantity)"
              className="w-full rounded-field border-2 border-brand bg-white px-4 py-3 text-lg font-medium placeholder:text-base placeholder:font-normal placeholder:text-muted/70" />
            <Link to="/shifts" className="whitespace-nowrap rounded-field border border-line px-3 py-3 text-sm font-medium hover:bg-paper">End shift</Link>
          </div>
          {shown.length > 0 && (
            <ul className="absolute inset-x-3 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-panel border border-line bg-white shadow-xl">
              {shown.map((p) => (
                <li key={p.id}>
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => addProduct(p, parseScan(scan).quantity)} className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-brand-soft">
                    <span><span className="font-semibold">{p.name}</span>{p.brand && <span className="ml-2 text-sm text-muted">{p.brand}</span>}</span>
                    <span className="text-sm"><b>{money(p.price)}</b> <span className="ml-2 text-muted">{fmtNum(p.stock)} in stock</span></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {cart.length === 0 ? (
            <Empty title="Ready to scan" hint="Scan the first item. Use F4 to pay, F8 to hold a sale and F9 to resume one." />
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-paper text-left text-muted">
                <tr><th className="px-3 py-2 font-medium">Item</th><th className="px-3 py-2 font-medium">Qty</th><th className="px-3 py-2 text-right font-medium">Price</th><th className="px-3 py-2 text-right font-medium">Total</th><th /></tr>
              </thead>
              <tbody>
                {cart.map((l, i) => (
                  <tr key={`${l.productId}-${i}`} onClick={() => setSelected(i)} className={`border-b border-line/60 ${i === selected ? 'bg-brand-soft' : 'bg-white'}`}>
                    <td className="px-3 py-2.5">
                      <div className="font-semibold">{l.name}</div>
                      <div className="flex gap-2 text-xs text-muted">
                        {l.quantity > l.stock && <Badge tone="warn">Only {fmtNum(l.stock)} in stock</Badge>}
                        {l.unitPrice !== undefined && <Badge tone="warn">Price override</Badge>}
                        {(l.discountPercent ?? 0) > 0 && <Badge tone="good">{l.discountPercent}% off</Badge>}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <input aria-label={`Quantity of ${l.name}`} inputMode="decimal" value={l.quantity} onFocus={(e) => e.target.select()} onChange={(e) => { const q = Number(e.target.value); if (q > 0) setLine(i, { quantity: q }); }} onKeyDown={(e) => e.key === 'Enter' && focusScan()} className="w-20 rounded-field border border-line px-2 py-1 text-center font-semibold" />
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {l.unitPrice !== undefined ? <><s className="text-muted">{fmtNum(l.price)}</s> {fmtNum(l.unitPrice)}</> : fmtNum(l.price)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-bold">{fmtNum(lineTotal(l))}</td>
                    <td className="whitespace-nowrap px-2 text-right">
                      {can('discount:apply') && <button type="button" title="Discount %" onClick={() => { const v = Number(window.prompt('Discount percent (0-100)', String(l.discountPercent ?? 0))); if (v >= 0 && v <= 100) setLine(i, { discountPercent: v || undefined }); focusScan(); }} className="rounded px-2 py-1 text-muted hover:bg-ink/5">%</button>}
                      <button type="button" title="Override price (manager approval)" onClick={() => { const v = window.prompt('New unit price (needs manager approval)', String(l.unitPrice ?? l.price)); if (v !== null && Number(v) >= 0) setLine(i, { unitPrice: Number(v) === l.price ? undefined : Number(v) }); focusScan(); }} className="rounded px-2 py-1 text-muted hover:bg-ink/5">{currencyCode()}</button>
                      <button type="button" aria-label={`Remove ${l.name}`} onClick={() => removeLine(i)} className="rounded px-2 py-1 text-danger hover:bg-danger-soft">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <aside className="flex flex-col border-t border-line bg-tape text-white lg:border-l lg:border-t-0">
        <div className="flex items-center justify-between px-5 pt-4 text-sm text-white/70">
          <span>{session.register?.name} · since {dateTime(session.openedAt)}</span>
          <span>{fmtNum(itemCount)} items</span>
        </div>
        <div className="flex-1 space-y-1 px-5 py-4">
          <CustomerPicker customer={customer} online={online} onChange={setCustomer} />
          <div className="flex justify-between text-white/70"><span>Subtotal</span><span>{money(totals.subtotal)}</span></div>
          {totals.discount > 0 && <div className="flex justify-between text-amber"><span>Discounts</span><span>-{money(totals.discount)}</span></div>}
          <p className="pt-4 text-sm text-white/70">Total</p>
          <p className="text-5xl font-bold tracking-tight" aria-live="polite">{money(totals.total)}</p>
          {!fresh && cart.length > 0 && !online && <p className="pt-2 text-xs text-amber">Offline: promotions and tax are applied when the sale syncs.</p>}
        </div>
        <div className="grid grid-cols-2 gap-2 p-4">
          <Button variant="secondary" onClick={() => void hold()} disabled={!cart.length}>Hold <kbd className="ml-1 text-xs opacity-60">F8</kbd></Button>
          <Button variant="secondary" onClick={() => setHeldOpen(true)}>Resume <kbd className="ml-1 text-xs opacity-60">F9</kbd></Button>
          <Button variant="ghost" className="!text-white hover:!bg-white/10" onClick={() => setClearing(true)} disabled={!cart.length}>Cancel sale</Button>
          <Button size="lg" className="col-span-2 !bg-amber !text-ink hover:!brightness-95 disabled:!bg-amber/40" onClick={() => setPaying(true)} disabled={!cart.length}>Pay <kbd className="ml-1 text-xs opacity-60">F4</kbd></Button>
        </div>
      </aside>

      {paying && <PayModal total={totals.total} busy={busy} error={payError} onClose={() => { setPaying(false); focusScan(); }} onConfirm={(p) => void complete(p)} />}
      {dialog}
      <ReceiptModal receipt={receipt?.data ?? null} saleId={receipt?.id} queued={receipt?.queued} onClose={() => { setReceipt(null); focusScan(); }} />
      <Confirm open={clearing} title="Cancel this sale?" message="Every item in the cart will be removed. Nothing has been charged or deducted from stock." confirmLabel="Cancel sale" danger onCancel={() => { setClearing(false); focusScan(); }} onConfirm={() => { setClearing(false); reset(); }} />
      <Modal open={heldOpen} onClose={() => { setHeldOpen(false); focusScan(); }} title="Held sales">
        {!online ? <p className="text-sm text-muted">Held sales are stored on the server and can’t be loaded offline.</p> : held.isLoading ? <Loading /> : !held.data?.length ? <Empty title="No held sales" /> : (
          <ul className="divide-y divide-line">
            {held.data.map((h) => (
              <li key={h.id} className="flex items-center justify-between py-2.5">
                <div><p className="font-medium">{h.payload.items.length} items · {fmtNum(h.payload.items.reduce((s, l) => s + l.quantity, 0))} units</p><p className="text-xs text-muted">{dateTime(h.createdAt)}</p></div>
                <Button size="sm" onClick={() => void resume(h.id)}>Resume</Button>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
};

export const Pos = () => {
  const session = useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      try {
        const current = await api<Session | null>('/sessions/current');
        localStorage.setItem('pos.shift', JSON.stringify(current));
        return current;
      } catch (err) {
        if (err instanceof ApiError && err.isNetwork) return JSON.parse(localStorage.getItem('pos.shift') ?? 'null') as Session | null;
        throw err;
      }
    },
  });
  if (session.isLoading) return <Loading />;
  return session.data ? <Register session={session.data} /> : <OpenShift />;
};
