import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';

export type Row = Record<string, unknown>;
export type Cell = string | number | boolean;

const MAX_CELL_CHARS = 20_000;

/** Converts a database value to something Google Sheets stores as-is (numbers stay numbers, dates become ISO text). */
export const toCell = (value: unknown): Cell => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Prisma.Decimal.isDecimal(value)) return (value as Prisma.Decimal).toNumber();
  return (typeof value === 'object' ? JSON.stringify(value) : String(value)).slice(0, MAX_CELL_CHARS);
};

/** Spreadsheet column letter for a zero-based index (0 -> A, 26 -> AA). */
export const columnLetter = (index: number): string => (index < 26 ? '' : columnLetter(Math.floor(index / 26) - 1)) + String.fromCharCode(65 + (index % 26));

const normalise = (value: unknown) => (typeof value === 'number' ? String(Math.round(value * 1e6) / 1e6) : String(value ?? ''));

/** Fingerprint of a set of cells; equal for the same data whether it came from the database or from the sheet. */
export const fingerprint = (values: unknown[]) => createHash('sha1').update(JSON.stringify(values.map(normalise))).digest('hex');
