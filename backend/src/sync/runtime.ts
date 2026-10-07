import { badRequest, notFound } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { fingerprint, toCell } from './cells';
import { ENTITIES } from './entities';
import { syncOnce } from './engine';
import { googleSheets, OfflineError, parseSpreadsheetId, prepareSpreadsheet, SheetsError, type SheetsApi } from './sheets';
import { counts, loadConfig, saveConfig, writeLogOnce } from './store';

/** What the host application (the Electron shell) provides: Google credentials and a few system services. */
export interface SyncHost {
  accessToken(): Promise<string | null>;
  isConnected(): boolean;
  isOnline(): boolean;
  backup(): Promise<unknown>;
}

let host: Partial<SyncHost> = {};
let testApi: SheetsApi | null = null;
let running = false;
let offline = false;
let lastError: string | null = null;

export const configureSync = (next: Partial<SyncHost>) => {
  host = { ...host, ...next };
};
/** Replaces Google with another implementation (tests). */
export const useSheetsApi = (api: SheetsApi | null) => {
  testApi = api;
};

const sheetsApi = (): SheetsApi | null =>
  testApi ??
  (host.accessToken
    ? googleSheets(async () => {
        const token = await host.accessToken!();
        if (!token) throw new SheetsError(401, 'Google Sheets is not connected. Connect it in Settings.');
        return token;
      })
    : null);

const friendly = (err: unknown) =>
  err instanceof OfflineError ? 'Cannot reach Google. Check the internet connection.' : err instanceof SheetsError ? err.message : (err as Error).message;

export const getStatus = async () => {
  const config = await loadConfig();
  return {
    configured: Boolean(config.spreadsheetId),
    connected: testApi ? true : (host.isConnected?.() ?? false),
    online: !offline,
    running,
    spreadsheetUrl: config.spreadsheetId ? `https://docs.google.com/spreadsheets/d/${config.spreadsheetId}` : null,
    spreadsheetTitle: config.spreadsheetTitle,
    lastSyncedAt: config.lastSyncedAt,
    lastError,
    ...(await counts()),
  };
};

export interface RunResult {
  ok: boolean;
  skipped?: 'busy' | 'not-configured' | 'offline';
  error?: string;
}

/** Runs one synchronisation unless one is already running, Google is not set up, or the PC is offline. */
export const runSync = async (): Promise<RunResult> => {
  const api = sheetsApi();
  const config = await loadConfig();
  if (running) return { ok: false, skipped: 'busy' };
  if (!api || !config.spreadsheetId) return { ok: false, skipped: 'not-configured' };
  if (host.isOnline && !host.isOnline()) {
    offline = true;
    return { ok: false, skipped: 'offline' };
  }
  running = true;
  try {
    await syncOnce(api, config, { backup: host.backup });
    await saveConfig({ initialDone: true, lastSyncedAt: new Date().toISOString() });
    offline = false;
    lastError = null;
    return { ok: true };
  } catch (err) {
    if (err instanceof OfflineError) {
      offline = true;
      return { ok: false, skipped: 'offline' };
    }
    lastError = friendly(err);
    await writeLogOnce('ERROR', `Synchronisation failed: ${lastError}`);
    return { ok: false, error: lastError };
  } finally {
    running = false;
  }
};

const QUEUE_ID: Record<string, string> = { StockLevel: `"productId" || ':' || "branchId"`, Setting: '"key"' };

/** Queues records that exist but were never queued (data from before synchronisation, or from a restored backup). */
const queueExisting = async () => {
  for (const { entity } of ENTITIES) {
    const where = entity === 'Setting' ? `WHERE "key" NOT LIKE 'sync.%'` : '';
    await prisma.$executeRawUnsafe(
      `INSERT OR IGNORE INTO "SyncState" ("entity", "recordId", "status", "changedAt")
       SELECT '${entity}', ${QUEUE_ID[entity] ?? '"id"'}, 'PENDING', strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now') FROM "${entity}" ${where}`,
    );
  }
};

/** Marks everything as not yet sent, so the next run sends all data again (for a new or emptied spreadsheet). */
export const resendAll = async () => {
  await queueExisting();
  await prisma.syncState.updateMany({ data: { status: 'PENDING', remoteHash: null, error: null, attempts: 0 } });
  await saveConfig({ initialDone: false });
};

export const connectSpreadsheet = async (input: { mode: 'create' | 'existing'; title?: string; url?: string }) => {
  const api = sheetsApi();
  if (!api) throw badRequest('Connect your Google account first.');
  try {
    const create = input.mode === 'create';
    const id = create ? await api.create(input.title || 'Supermarket POS') : parseSpreadsheetId(input.url ?? '');
    const spreadsheetTitle = await prepareSpreadsheet(api, id, create);
    await saveConfig({ spreadsheetId: id, spreadsheetTitle, lastSyncedAt: null });
    await resendAll();
  } catch (err) {
    throw badRequest(friendly(err));
  }
  void runSync();
  return getStatus();
};

// ---------- conflicts ----------
export const listConflicts = () => prisma.syncLog.findMany({ where: { level: 'CONFLICT', resolution: null }, orderBy: { createdAt: 'desc' } });

/**
 * Settles a conflict by moving the "last agreed" fingerprint, so the next run applies the chosen side:
 * SHEET makes the POS look unchanged (the sheet's edit is applied); LOCAL makes the sheet look unchanged (the POS's value is sent).
 */
export const resolveConflict = async (logId: string, use: 'SHEET' | 'LOCAL') => {
  const log = await prisma.syncLog.findUnique({ where: { id: logId } });
  const spec = ENTITIES.find((e) => e.entity === log?.entity);
  if (!log || log.level !== 'CONFLICT' || !spec?.pull || !log.recordId) throw notFound('Conflict');
  if (log.resolution) throw badRequest('This conflict was already resolved.');
  const cells = (use === 'SHEET' ? log.local : log.sheet) as unknown as Record<string, unknown>;
  const baseline = fingerprint(spec.pull.editable.map((column) => toCell(cells[column])));
  await prisma.syncState.update({ where: { entity_recordId: { entity: spec.entity, recordId: log.recordId } }, data: { status: 'PENDING', remoteHash: baseline } });
  await prisma.syncLog.update({ where: { id: logId }, data: { resolution: use, resolvedAt: new Date() } });
  void runSync();
};

export const recentLog = () => prisma.syncLog.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });

// ---------- background schedule ----------
const TICK_MS = 60_000;
const FULL_CHECK_MS = 10 * 60_000;
const MAX_BACKOFF_MS = 15 * 60_000;

/** Synchronises soon after start, then whenever records are waiting, and every ten minutes to pick up sheet edits. */
export const startSyncScheduler = () => {
  let failures = 0;
  let nextAllowed = 0;
  let lastRun = 0;
  const tick = async () => {
    if (Date.now() < nextAllowed || !(testApi || host.isConnected?.())) return;
    const { pending, failed } = await counts();
    if (!pending && !failed && Date.now() - lastRun < FULL_CHECK_MS) return;
    const result = await runSync();
    lastRun = Date.now();
    if (result.ok || result.skipped) failures = 0;
    else failures++;
    nextAllowed = result.error ? Date.now() + Math.min(MAX_BACKOFF_MS, TICK_MS * 2 ** failures) : 0;
  };
  const run = () => void tick().catch((err: unknown) => console.error('Sync tick failed', err));
  setTimeout(run, 10_000).unref();
  return setInterval(run, TICK_MS).unref();
};
