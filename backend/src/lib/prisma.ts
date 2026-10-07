import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { env } from '../config/env';

export const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: env.DATABASE_URL }) });

export type Tx = Prisma.TransactionClient;
export type Db = PrismaClient | Tx;

export const transact = <T>(fn: (tx: Tx) => Promise<T>) =>
  prisma.$transaction(fn, { timeout: 30_000, maxWait: 10_000 });
