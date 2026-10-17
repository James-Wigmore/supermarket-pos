import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { env } from '../config/env';

export const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: env.DATABASE_URL }) });

export type Tx = Prisma.TransactionClient;
export type Db = PrismaClient | Tx;

export const ensureDatabaseReady = async () => {
  const userInfo = await prisma.$queryRawUnsafe<Array<{ name: string }>>('PRAGMA table_info("User")');
  const userColumns = new Set(userInfo.map((column) => column.name));
  const loginApprovalTable = await prisma.$queryRawUnsafe<Array<{ name: string }>>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'LoginApproval'");

  if (!userColumns.has('emailApprovalEnabled')) {
    throw new Error('The SQLite database is out of date: the User table is missing the emailApprovalEnabled column. Run "npm run db:migrate" in the backend, or recreate the database from a clean backup.');
  }
  if (loginApprovalTable.length === 0) {
    throw new Error('The SQLite database is missing the LoginApproval table. Run "npm run db:migrate" in the backend to apply the required schema.');
  }
};

export const transact = <T>(fn: (tx: Tx) => Promise<T>) =>
  prisma.$transaction(fn, { timeout: 30_000, maxWait: 10_000 });
