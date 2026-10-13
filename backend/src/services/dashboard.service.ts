import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { getSettings } from '../lib/settings';
import { branchFor } from '../lib/scope';
import { PROFIT_SQL, branchSql, rawRows as q } from '../lib/sql';
import { businessToday, dayKey, recentDays, startOfDay } from '../lib/time';
import type { Actor } from '../types';
import { movingProducts } from './report.service';

const DAY_MS = 86_400_000;
const TREND_DAYS = 14;

/** Revenue and transaction count per local day for the last two weeks, including empty days. */
const salesTrend = async (branchId?: string) => {
  const days = recentDays(TREND_DAYS);
  const sales = await prisma.sale.findMany({
    where: { status: 'COMPLETED', branchId, soldAt: { gte: startOfDay(new Date(Date.now() - (TREND_DAYS - 1) * DAY_MS)) } },
    select: { soldAt: true, total: true },
  });
  const byDay = new Map(days.map((day) => [day, { day, revenue: 0, transactions: 0 }]));
  for (const sale of sales) {
    const entry = byDay.get(dayKey(sale.soldAt));
    if (entry) {
      entry.revenue += sale.total.toNumber();
      entry.transactions += 1;
    }
  }
  return [...byDay.values()];
};

/** Batches still on the shelf that expire within the configured alert window, and those already past their date. */
const expiryAlerts = async (branchId?: string) => {
  const { expiryAlertDays } = await getSettings(prisma);
  const today = businessToday();
  const onShelf = { branchId, quantity: { gt: 0 } };
  const [expiringSoon, expired] = await Promise.all([
    prisma.productBatch.count({ where: { ...onShelf, expiryDate: { gte: today, lt: new Date(today.getTime() + (expiryAlertDays + 1) * DAY_MS) } } }),
    prisma.productBatch.count({ where: { ...onShelf, expiryDate: { lt: today } } }),
  ]);
  return { windowDays: expiryAlertDays, expiringSoon, expired };
};

export const dashboard = async (actor: Actor, requestedBranch?: string) => {
  const branchId = branchFor(actor, requestedBranch);
  const today = Prisma.sql`s.status = 'COMPLETED' AND s."soldAt" >= ${startOfDay()} ${branchSql('s."branchId"', branchId)}`;
  const stockJoin = Prisma.sql`
    FROM "Product" p
    LEFT JOIN (SELECT "productId", SUM(quantity) AS q FROM "StockLevel" WHERE true ${branchSql('"branchId"', branchId)} GROUP BY 1) st ON st."productId" = p.id
    WHERE p."isActive"`;
  const now = new Date();

  const [totals, items, profit, payments, trend, stock, lowStock, recent, cashiers, fast, slow] = await Promise.all([
    q<{ transactions: number; revenue: number }>(Prisma.sql`SELECT COUNT(*) AS transactions, COALESCE(SUM(s.total), 0) AS revenue FROM "Sale" s WHERE ${today}`),
    q<{ items: number }>(Prisma.sql`SELECT COALESCE(SUM(si.quantity - si."returnedQty"), 0) AS items FROM "SaleItem" si JOIN "Sale" s ON s.id = si."saleId" WHERE ${today}`),
    q<{ profit: number }>(Prisma.sql`SELECT COALESCE(SUM(${PROFIT_SQL}), 0) AS profit FROM "SaleItem" si JOIN "Sale" s ON s.id = si."saleId" WHERE ${today}`),
    q(Prisma.sql`SELECT pay.method AS method, SUM(pay.amount) AS amount FROM "Payment" pay JOIN "Sale" s ON s.id = pay."saleId" WHERE ${today} GROUP BY 1 ORDER BY amount DESC`),
    salesTrend(branchId),
    q<{ value: number; low: number; out: number }>(Prisma.sql`
      SELECT COALESCE(SUM(MAX(COALESCE(st.q, 0), 0) * p."purchasePrice"), 0) AS value,
             COUNT(*) FILTER (WHERE COALESCE(st.q, 0) > 0 AND COALESCE(st.q, 0) <= p."minStock") AS low,
             COUNT(*) FILTER (WHERE COALESCE(st.q, 0) <= 0) AS out ${stockJoin}`),
    q(Prisma.sql`SELECT p.id, p.name, p.sku, COALESCE(st.q, 0) AS quantity, p."minStock" AS "minStock" ${stockJoin}
                 AND COALESCE(st.q, 0) <= p."minStock" ORDER BY COALESCE(st.q, 0), p.name LIMIT 10`),
    q(Prisma.sql`SELECT s.id, s."receiptNo", s.total AS total, s."soldAt", s.status AS status, u.name AS cashier
                 FROM "Sale" s JOIN "User" u ON u.id = s."cashierId" WHERE true ${branchSql('s."branchId"', branchId)} ORDER BY s."soldAt" DESC LIMIT 10`),
    q(Prisma.sql`SELECT u.name AS cashier, COUNT(*) AS transactions, SUM(s.total) AS revenue
                 FROM "Sale" s JOIN "User" u ON u.id = s."cashierId" WHERE ${today} GROUP BY u.name ORDER BY revenue DESC LIMIT 10`),
    movingProducts(branchId, new Date(now.getTime() - 7 * DAY_MS), now, 'fast', 5),
    movingProducts(branchId, new Date(now.getTime() - 30 * DAY_MS), now, 'slow', 5),
  ]);

  return {
    today: { ...totals[0]!, ...items[0]!, grossProfit: profit[0]!.profit },
    payments, trend, stockValue: stock[0]!.value, lowStockCount: stock[0]!.low, outOfStockCount: stock[0]!.out,
    lowStock, recent, cashiers, fastMoving: fast, slowMoving: slow, expiry: await expiryAlerts(branchId),
  };
};
