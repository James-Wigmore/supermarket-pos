import type { Db } from './prisma';

/** Next value of a named counter. The upsert is atomic, so numbers are never reused. */
const nextValue = async (db: Db, name: 'document' | 'internal_barcode') =>
  (await db.counter.upsert({ where: { name }, create: { name, value: 1 }, update: { value: { increment: 1 } } })).value;

const dateStamp = (date = new Date()) => date.toISOString().slice(0, 10).replaceAll('-', '');

/** Human-readable unique document number, e.g. RCT-20261003-000042. */
export const nextNumber = async (db: Db, prefix: string) =>
  `${prefix}-${dateStamp()}-${String(await nextValue(db, 'document')).padStart(6, '0')}`;

const ean13CheckDigit = (digits: string) => {
  const total = [...digits].reduce((acc, ch, i) => acc + Number(ch) * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (total % 10)) % 10;
};

/** In-store EAN-13 (prefix 20 is reserved for internal use), compatible with any scanner. */
export const nextInternalBarcode = async (db: Db) => {
  const base = `20${String(await nextValue(db, 'internal_barcode')).padStart(10, '0')}`;
  return `${base}${ean13CheckDigit(base)}`;
};
