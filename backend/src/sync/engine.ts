import type { Prisma } from '@prisma/client';
import { audit } from '../lib/audit';
import { prisma, transact, type Db } from '../lib/prisma';
import { columnLetter, fingerprint, toCell, type Row } from './cells';
import { ENTITIES, LOG_TAB, rowCells, type EntitySpec } from './entities';
import { OfflineError, SheetsError, type SheetsApi } from './sheets';
import { writeLog, writeLogOnce, type SyncConfig } from './store';

const CHUNK = 500;
/** A run that would change this many records from the sheet makes a safety backup first. */
const BULK_PULL = 25;

export interface RunHooks {
  backup?: () => Promise<unknown>;
}
export interface RunStats {
  pushed: number;
  pulled: number;
  created: number;
  conflicts: number;
}

interface TabData {
  /** record id -> sheet row number */
  ids: Map<string, number>;
  /** Full rows (only read for tabs the owner may edit). */
  rows: { row: number; values: Row }[];
}

type Decision = 'adopt' | 'push' | 'pull' | 'conflict';

/**
 * Compares the record as the POS has it now (`local`), as the sheet has it now (`sheet`) and as both last agreed
 * (`base`). Whoever changed alone wins; if both changed differently nobody wins until an administrator decides.
 */
export const decide = (base: string | null | undefined, local: string, sheet: string): Decision => {
  if (local === sheet) return 'adopt';
  if (!base) return 'conflict';
  if (sheet === base) return 'push';
  if (local === base) return 'pull';
  return 'conflict';
};

const editableHash = (editable: string[], row: Row) => fingerprint(editable.map((column) => toCell(row[column])));
const editableCells = (editable: string[], row: Row) => Object.fromEntries(editable.map((column) => [column, toCell(row[column])]));
const idOf = (spec: EntitySpec, row: Row) => String(row[spec.columns[0]!]);
const errorText = (err: unknown) =>
  err instanceof Error && 'issues' in err ? (err as { issues: { path: unknown[]; message: string }[] }).issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : (err as Error).message;

const fetchAll = async (spec: EntitySpec, ids: string[]) => {
  const rows: Row[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) rows.push(...(await spec.fetch(ids.slice(i, i + CHUNK))));
  return rows;
};

// ---------- reading the sheet ----------
const readSheets = async (api: SheetsApi, spreadsheetId: string) => {
  const ranges = ENTITIES.map((spec) => `${spec.tab}!A:${spec.pull ? columnLetter(spec.columns.length - 1) : 'A'}`);
  const values = await api.read(spreadsheetId, ranges);
  return new Map(ENTITIES.map((spec, i) => {
    const tab: TabData = { ids: new Map(), rows: [] };
    (values[i] ?? []).forEach((raw, index) => {
      const id = String(raw[0] ?? '').trim();
      const row = index + 1;
      if (index === 0 || (id && tab.ids.has(id))) return;
      if (id) tab.ids.set(id, row);
      if (spec.pull) tab.rows.push({ row, values: Object.fromEntries(spec.columns.map((column, j) => [column, raw[j] ?? ''])) });
    });
    return [spec.entity, tab] as const;
  }));
};

// ---------- pulling owner edits ----------
const setState = (entity: string, recordId: string, status: 'SYNCED' | 'PENDING' | 'CONFLICT', remoteHash: string | null | undefined, db: Db = prisma) => {
  const now = new Date();
  const synced = status === 'SYNCED' ? { lastSyncedAt: now, error: null, attempts: 0 } : {};
  return db.syncState.upsert({
    where: { entity_recordId: { entity, recordId } },
    create: { entity, recordId, status, changedAt: now, remoteHash: remoteHash ?? null, remoteRef: entity, ...synced },
    update: { status, ...(remoteHash === undefined ? {} : { remoteHash }), ...synced },
  });
};

const recordConflict = async (spec: EntitySpec, id: string, local: Row, sheet: Row) => {
  const editable = spec.pull!.editable;
  const open = await prisma.syncLog.findFirst({ where: { level: 'CONFLICT', entity: spec.entity, recordId: id, resolution: null } });
  if (!open) {
    await writeLog('CONFLICT', `${spec.tab}: record ${id} was changed in both the POS and Google Sheets.`, {
      entity: spec.entity, recordId: id, local: editableCells(editable, local), sheet: editableCells(editable, sheet),
    });
  }
  await setState(spec.entity, id, 'CONFLICT', undefined);
};

type PullAction = () => Promise<void>;

/** Works out what to do with each editable row of a tab, without changing anything yet. */
const planPull = async (api: SheetsApi, spreadsheetId: string, spec: EntitySpec, tab: TabData, stats: RunStats): Promise<PullAction[]> => {
  const pull = spec.pull!;
  const { editable } = pull;
  const known = tab.rows.map((r) => String(r.values[spec.columns[0]!] ?? '').trim()).filter(Boolean);
  const [localRows, states] = await Promise.all([
    fetchAll(spec, known),
    prisma.syncState.findMany({ where: { entity: spec.entity, recordId: { in: known } } }),
  ]);
  const local = new Map(localRows.map((r) => [idOf(spec, r), r]));
  const state = new Map(states.map((s) => [s.recordId, s]));
  const actions: PullAction[] = [];
  const reject = (row: number, err: unknown, recordId?: string) =>
    writeLogOnce('ERROR', `${spec.tab} row ${row}: ${errorText(err)}`, { entity: spec.entity, recordId });

  for (const { row, values } of tab.rows) {
    const id = String(values[spec.columns[0]!] ?? '').trim();

    if (!id) {
      if (!pull.create || editable.every((c) => String(values[c] ?? '').trim() === '')) continue;
      actions.push(async () => {
        try {
          const parsed = pull.parse(values, true);
          const newId = await transact((tx) => pull.create!(tx, parsed));
          const [created] = await spec.fetch([newId]);
          await api.write(spreadsheetId, [{ range: `${spec.tab}!A${row}:${columnLetter(spec.columns.length - 1)}${row}`, values: [rowCells(spec.columns, created!)] }]);
          await setState(spec.entity, newId, 'SYNCED', editableHash(editable, created!));
          stats.created++;
        } catch (err) {
          if (err instanceof OfflineError || err instanceof SheetsError) throw err;
          await reject(row, err);
        }
      });
      continue;
    }

    const mine = local.get(id);
    const current = state.get(id);
    if (!mine || current?.status === 'CONFLICT') continue;
    const mineHash = editableHash(editable, mine);
    const sheetHash = editableHash(editable, values);
    const decision = decide(current?.remoteHash, mineHash, sheetHash);

    if (decision === 'adopt' && !(current?.status === 'SYNCED' && current.remoteHash === mineHash)) actions.push(async () => void (await setState(spec.entity, id, 'SYNCED', mineHash)));
    else if (decision === 'push' && current?.status !== 'PENDING' && current?.status !== 'FAILED') actions.push(async () => void (await setState(spec.entity, id, 'PENDING', undefined)));
    else if (decision === 'conflict') actions.push(() => recordConflict(spec, id, mine, values));
    else if (decision === 'pull') {
      actions.push(async () => {
        try {
          const parsed = pull.parse(values, false);
          await transact(async (tx) => {
            await pull.update(tx, id, parsed);
            await audit(tx, null, { action: 'SHEETS_PULL', entity: spec.entity, entityId: id, before: editableCells(editable, mine), after: editableCells(editable, values) });
            await setState(spec.entity, id, 'SYNCED', sheetHash, tx);
          });
          stats.pulled++;
        } catch (err) {
          await reject(row, err, id);
        }
      });
    }
  }
  return actions;
};

// ---------- pushing the POS's changes ----------
const markAll = (entity: string, ids: string[], from: string[], data: Prisma.SyncStateUpdateManyMutationInput) =>
  prisma.syncState.updateMany({ where: { entity, recordId: { in: ids }, status: { in: from } }, data });

const markSynced = (spec: EntitySpec, rows: Row[], ids: string[]) => {
  const done = { status: 'SYNCED', lastSyncedAt: new Date(), error: null, attempts: 0, remoteRef: spec.tab };
  if (!spec.pull) return markAll(spec.entity, ids, ['SYNCING'], done);
  const { editable } = spec.pull;
  return prisma.$transaction(rows.map((row) =>
    prisma.syncState.updateMany({ where: { entity: spec.entity, recordId: idOf(spec, row), status: 'SYNCING' }, data: { ...done, remoteHash: editableHash(editable, row) } })));
};

const pushEntity = async (api: SheetsApi, spreadsheetId: string, spec: EntitySpec, tab: TabData, stats: RunStats) => {
  const queued = await prisma.syncState.findMany({ where: { entity: spec.entity, status: { in: ['PENDING', 'FAILED'] } }, select: { recordId: true }, orderBy: { changedAt: 'asc' } });
  const lastColumn = columnLetter(spec.columns.length - 1);

  for (let i = 0; i < queued.length; i += CHUNK) {
    const ids = queued.slice(i, i + CHUNK).map((q) => q.recordId);
    await markAll(spec.entity, ids, ['PENDING', 'FAILED'], { status: 'SYNCING', lastAttemptAt: new Date(), attempts: { increment: 1 } });
    const rows = await spec.fetch(ids);
    const present = new Set(rows.map((r) => idOf(spec, r)));
    const gone = ids.filter((id) => !present.has(id));
    if (gone.length) await prisma.syncState.deleteMany({ where: { entity: spec.entity, recordId: { in: gone } } });

    const updates = rows.filter((r) => tab.ids.has(idOf(spec, r)));
    const inserts = rows.filter((r) => !tab.ids.has(idOf(spec, r)));
    try {
      if (updates.length) {
        await api.write(spreadsheetId, updates.map((r) => {
          const n = tab.ids.get(idOf(spec, r))!;
          return { range: `${spec.tab}!A${n}:${lastColumn}${n}`, values: [rowCells(spec.columns, r)] };
        }));
      }
      if (inserts.length) await api.append(spreadsheetId, spec.tab, inserts.map((r) => rowCells(spec.columns, r)));
      await markSynced(spec, rows, ids);
      stats.pushed += rows.length;
    } catch (err) {
      if (err instanceof OfflineError) {
        await markAll(spec.entity, ids, ['SYNCING'], { status: 'PENDING', attempts: { decrement: 1 } });
        throw err;
      }
      await markAll(spec.entity, ids, ['SYNCING'], { status: 'FAILED', error: errorText(err).slice(0, 500) });
      return; // this tab will be retried next run; other tabs carry on
    }
  }
};

const pushLog = async (api: SheetsApi, spreadsheetId: string) => {
  const entries = await prisma.syncLog.findMany({ where: { pushedAt: null }, orderBy: { createdAt: 'asc' }, take: CHUNK });
  if (!entries.length) return;
  await api.append(spreadsheetId, LOG_TAB.tab, entries.map((e) => rowCells(LOG_TAB.columns, e)));
  await prisma.syncLog.updateMany({ where: { id: { in: entries.map((e) => e.id) } }, data: { pushedAt: new Date() } });
};

/** One synchronisation: owner edits come in first, then the POS's pending changes go out. */
export const syncOnce = async (api: SheetsApi, config: SyncConfig, hooks: RunHooks = {}): Promise<RunStats> => {
  const spreadsheetId = config.spreadsheetId!;
  const stats: RunStats = { pushed: 0, pulled: 0, created: 0, conflicts: 0 };
  const tabs = await readSheets(api, spreadsheetId);

  const plan: PullAction[] = [];
  for (const spec of ENTITIES.filter((e) => e.pull)) plan.push(...(await planPull(api, spreadsheetId, spec, tabs.get(spec.entity)!, stats)));
  // A safety copy before the first sync with a spreadsheet, or before many records are changed from it.
  if (!config.initialDone || plan.length >= BULK_PULL) await hooks.backup?.();
  for (const action of plan) await action();

  for (const spec of ENTITIES) await pushEntity(api, spreadsheetId, spec, tabs.get(spec.entity)!, stats);
  await pushLog(api, spreadsheetId);
  stats.conflicts = await prisma.syncState.count({ where: { status: 'CONFLICT' } });
  return stats;
};
