import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

export type SyncStatusName = 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED' | 'CONFLICT';
export type LogLevel = 'INFO' | 'ERROR' | 'CONFLICT';

export interface SyncConfig {
  spreadsheetId: string | null;
  spreadsheetTitle: string | null;
  /** False until the first full synchronisation with the current spreadsheet has finished. */
  initialDone: boolean;
  lastSyncedAt: string | null;
}

const CONFIG_KEY = 'sync.config';
const EMPTY: SyncConfig = { spreadsheetId: null, spreadsheetTitle: null, initialDone: false, lastSyncedAt: null };
const DAY_MS = 86_400_000;

export const loadConfig = async (): Promise<SyncConfig> => {
  const row = await prisma.setting.findUnique({ where: { key: CONFIG_KEY } });
  return { ...EMPTY, ...((row?.value as Partial<SyncConfig> | null) ?? {}) };
};

export const saveConfig = async (patch: Partial<SyncConfig>) => {
  const value = { ...(await loadConfig()), ...patch } as unknown as Prisma.InputJsonValue;
  await prisma.setting.upsert({ where: { key: CONFIG_KEY }, create: { key: CONFIG_KEY, value }, update: { value } });
};

export const counts = async () => {
  const rows = await prisma.syncState.groupBy({ by: ['status'], _count: { _all: true } });
  const of = (...names: SyncStatusName[]) => rows.filter((r) => names.includes(r.status as SyncStatusName)).reduce((n, r) => n + r._count._all, 0);
  return { pending: of('PENDING', 'SYNCING'), failed: of('FAILED'), conflicts: of('CONFLICT') };
};

export const writeLog = (level: LogLevel, message: string, extra: { entity?: string; recordId?: string; local?: Prisma.InputJsonValue; sheet?: Prisma.InputJsonValue } = {}) =>
  prisma.syncLog.create({ data: { level, message: message.slice(0, 500), ...extra } });

/** Writes an error once a day: a problem that repeats every few minutes must not flood the journal. */
export const writeLogOnce = async (level: LogLevel, message: string, extra: Parameters<typeof writeLog>[2] = {}) => {
  const seen = await prisma.syncLog.findFirst({ where: { level, message: message.slice(0, 500), createdAt: { gte: new Date(Date.now() - DAY_MS) } } });
  if (!seen) await writeLog(level, message, extra);
};
