const nf = new Intl.NumberFormat('en-UG', { maximumFractionDigits: 2 });

const CURRENCY_KEY = 'pos.currency';
let currency = localStorage.getItem(CURRENCY_KEY) ?? 'UGX';
/** Currency code shown with amounts. Remembered between runs so the first screen is already right. */
export const currencyCode = () => currency;
export const setCurrency = (code: string) => {
  currency = code;
  localStorage.setItem(CURRENCY_KEY, code);
};

export const num = (value: unknown) => Number(value ?? 0);
/** What a person typed ("50,000", " 1 200.50 ") as a number, or NaN when it is not one. Blank is NaN too: never silently 0. */
export const typed = (text: string) => (/^\s*\d[\d,\s]*(\.\d+)?\s*$/.test(text) ? Number(text.replace(/[,\s]/g, '')) : NaN);
export const fmtNum = (value: unknown) => nf.format(num(value));
export const money = (value: unknown) => `${currency} ${nf.format(Math.round(num(value) * 100) / 100)}`;
export const date = (value?: string | Date | null) =>
  value ? new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
export const dateTime = (value?: string | Date | null) =>
  value ? new Date(value).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
export const uuid = () => crypto.randomUUID();
export const label = (value: string) => value.replaceAll('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

export const startOfDay = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const endOfDay = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
