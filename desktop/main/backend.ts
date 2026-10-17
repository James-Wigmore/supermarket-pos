import { app } from 'electron';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import type { RequestListener } from 'node:http';
import { basename, delimiter, dirname, join } from 'node:path';
import { loadConfig } from './config';
import { appRoot } from './paths';

/** What the synchronisation module needs from the desktop shell. */
export interface SyncHost {
  accessToken(): Promise<string | null>;
  isConnected(): boolean;
  isOnline(): boolean;
  backup(): Promise<unknown>;
}

export interface Backend {
  /** The Express application, called in-process (there is no network listener). */
  app: RequestListener;
  sync: { configureSync(host: SyncHost): void; startSyncScheduler(): unknown };
  dbFile: string;
  /** Writes a consistent copy of the live database to `file`. */
  backupTo(file: string): Promise<void>;
  close(): Promise<void>;
}

interface BackendModules {
  app: { createApp(): RequestListener };
  migrate: { migrate(): Promise<string[]> };
  sync: Backend['sync'];
  prisma: { prisma: { $executeRawUnsafe(sql: string): Promise<number>; $disconnect(): Promise<void> } };
}

/** Completes a restore chosen in the previous session. The replaced database is kept next to it as `.replaced`. */
const applyPendingRestore = (dbFile: string) => {
  const pending = `${dbFile}.restore`;
  if (!existsSync(pending)) return;
  for (const suffix of ['-wal', '-shm']) rmSync(dbFile + suffix, { force: true });
  if (existsSync(dbFile)) renameSync(dbFile, `${dbFile}.replaced`);
  renameSync(pending, dbFile);
};

const sqlString = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** Points the existing backend at the per-user database, runs migrations and returns it. */
export const startBackend = async (): Promise<Backend> => {
  const dbFile = join(app.getPath('userData'), 'data', 'pos.db');
  mkdirSync(dirname(dbFile), { recursive: true });
  applyPendingRestore(dbFile);
  const unpackedModules = join(process.resourcesPath, 'app.asar.unpacked', 'node_modules');
  if (existsSync(unpackedModules)) {
    process.env.NODE_PATH = [unpackedModules, process.env.NODE_PATH].filter(Boolean).join(delimiter);
    (require('node:module') as { Module: { _initPaths(): void } }).Module._initPaths();
  }
  // A relative path avoids drive letters and spaces in Windows profile names confusing the SQLite driver.
  process.chdir(dirname(dbFile));
  Object.assign(process.env, {
    NODE_ENV: 'production',
    DATABASE_URL: `file:./${basename(dbFile)}`,
    JWT_SECRET: loadConfig().jwtSecret,
    TIMEZONE: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });

  // The backend reads its configuration when first imported, so it is loaded only now.
  const load = <K extends keyof BackendModules>(file: string) => require(join(appRoot(), 'backend/dist', file)) as BackendModules[K];
  const { createApp } = load<'app'>('app');
  const { prisma } = load<'prisma'>('lib/prisma');
  await load<'migrate'>('lib/migrate').migrate();

  return {
    app: createApp(),
    sync: load<'sync'>('sync/runtime'),
    dbFile,
    backupTo: async (file) => {
      await prisma.$executeRawUnsafe(`VACUUM INTO ${sqlString(file)}`);
    },
    close: () => prisma.$disconnect(),
  };
};
