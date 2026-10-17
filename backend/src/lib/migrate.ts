import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prisma } from './prisma';

const DEFAULT_DIR = join(__dirname, '../../prisma/migrations');
const BREAKPOINT = '--> statement-breakpoint';

export const statementsOf = (file: string) =>
  readFileSync(file, 'utf8')
    .split(BREAKPOINT)
    .map((s) => s.trim())
    .filter((s) => s.replace(/--[^\r\n]*/g, '').trim().length > 0);
/** Configures SQLite and applies pending migrations in order. Safe to call on every start. */
export const migrate = async (dir = DEFAULT_DIR) => {
  await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL');
  await prisma.$queryRawUnsafe('PRAGMA busy_timeout = 5000');
  await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON');
  await prisma.$executeRawUnsafe(
    'CREATE TABLE IF NOT EXISTS "_migrations" ("name" TEXT NOT NULL PRIMARY KEY, "appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)',
  );
  const done = new Set((await prisma.$queryRawUnsafe<{ name: string }[]>('SELECT "name" FROM "_migrations"')).map((r) => r.name));
  const pending = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !done.has(e.name)).map((e) => e.name).sort();

  for (const name of pending) {
    await prisma.$transaction([
      ...statementsOf(join(dir, name, 'migration.sql')).map((sql) => prisma.$executeRawUnsafe(sql)),
      prisma.$executeRawUnsafe('INSERT INTO "_migrations" ("name") VALUES (?)', name),
    ]);
  }
  return pending;
};
