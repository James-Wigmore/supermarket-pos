import { app, dialog, type BrowserWindow } from 'electron';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Backend } from './backend';
import { loadConfig, updateConfig } from './config';

type Kind = 'manual' | 'auto' | 'pre-restore' | 'pre-sync';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Backups that are replaced by newer ones. Manual and pre-restore copies are never deleted automatically. */
const KEEP: Partial<Record<Kind, number>> = { auto: 14, 'pre-sync': 10 };
const SQLITE_HEADER = 'SQLite format 3\0';

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');

const prune = (dir: string, kind: Kind, keep: number) =>
  readdirSync(dir)
    .filter((name) => name.startsWith(`Supermarket-POS-${kind}-`) && name.endsWith('.db'))
    .sort()
    .slice(0, -keep)
    .forEach((name) => rmSync(join(dir, name), { force: true }));

export const createBackup = async (backend: Backend, kind: Kind) => {
  const { backupDir } = loadConfig();
  mkdirSync(backupDir, { recursive: true });
  const file = join(backupDir, `Supermarket-POS-${kind}-${stamp()}.db`);
  await backend.backupTo(file);
  updateConfig({ lastBackupAt: new Date().toISOString() });
  const keep = KEEP[kind];
  if (keep) prune(backupDir, kind, keep);
  return file;
};

/** Safety copy before a large synchronisation; skipped when any backup was made within the last hour. */
export const backupBeforeSync = async (backend: Backend) => {
  const { lastBackupAt } = loadConfig();
  if (lastBackupAt && Date.now() - Date.parse(lastBackupAt) < HOUR_MS) return null;
  return createBackup(backend, 'pre-sync');
};

/** A POS backup is a SQLite file whose schema (stored as plain text inside it) has our core tables. */
const looksLikePosBackup = (file: string) => {
  const bytes = readFileSync(file);
  return bytes.subarray(0, 16).toString('latin1') === SQLITE_HEADER && ['"User"', '"Sale"', '"Product"'].every((t) => bytes.includes(`CREATE TABLE ${t}`));
};

/**
 * Restores a backup the administrator picks. The file is only staged here; the database is swapped when the app restarts
 * (see `applyPendingRestore`), so nothing is ever replaced while it is open.
 */
export const restoreBackup = async (backend: Backend, parent: BrowserWindow) => {
  const picked = await dialog.showOpenDialog(parent, {
    title: 'Choose a backup to restore',
    defaultPath: loadConfig().backupDir,
    filters: [{ name: 'POS backup', extensions: ['db'] }],
    properties: ['openFile'],
  });
  const source = picked.filePaths[0];
  if (picked.canceled || !source) return null;
  if (!looksLikePosBackup(source)) throw new Error('That file is not a Supermarket POS backup.');

  const { response } = await dialog.showMessageBox(parent, {
    type: 'warning', buttons: ['Restore and restart', 'Cancel'], defaultId: 1, cancelId: 1, title: 'Restore backup',
    message: 'Replace all current data with this backup?',
    detail: 'A safety copy of the current data is saved first. The app restarts when the restore is done.',
  });
  if (response !== 0) return null;

  await createBackup(backend, 'pre-restore');
  copyFileSync(source, `${backend.dbFile}.restore`);
  app.relaunch();
  app.quit();
  return source;
};

/** Daily automatic backup while the app is open (checked hourly, so a PC that is off at night still catches up). */
export const startAutoBackup = (backend: Backend) => {
  const tick = () => {
    const { autoBackup, lastBackupAt } = loadConfig();
    if (!autoBackup || Date.now() - (lastBackupAt ? Date.parse(lastBackupAt) : 0) < DAY_MS) return;
    createBackup(backend, 'auto').catch((err: unknown) => console.error('Automatic backup failed', err));
  };
  tick();
  return setInterval(tick, HOUR_MS);
};
