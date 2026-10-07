import { Prisma } from '@prisma/client';
import { prisma } from './prisma';

export const branchSql = (column: string, branchId?: string) =>
  branchId ? Prisma.sql`AND ${Prisma.raw(column)} = ${branchId}` : Prisma.empty;

const plain = (value: unknown) =>
  typeof value === 'bigint' ? Number(value) : Prisma.Decimal.isDecimal(value) ? (value as Prisma.Decimal).toNumber() : value;

/** Runs raw SQL and returns plain JSON-safe rows (SQLite integers/decimals become numbers). */
export const rawRows = async <T = Record<string, unknown>>(query: Prisma.Sql) =>
  (await prisma.$queryRaw<Record<string, unknown>[]>(query)).map(
    (row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, plain(value)])),
  ) as T[];

/** Share of a sale item that was not returned. `1.0 *` avoids SQLite integer division. */
const KEPT = Prisma.sql`(1.0 * (si.quantity - si."returnedQty") / si.quantity)`;

/** Net-of-returns, net-of-tax revenue, tax, cost and gross profit of a sale item row `si`. */
export const NET_REVENUE_SQL = Prisma.sql`((si."lineTotal" - si."taxAmount") * ${KEPT})`;
export const TAX_SQL = Prisma.sql`(si."taxAmount" * ${KEPT})`;
export const COST_SQL = Prisma.sql`(si."unitCost" * (si.quantity - si."returnedQty"))`;
export const PROFIT_SQL = Prisma.sql`(${NET_REVENUE_SQL} - ${COST_SQL})`;
