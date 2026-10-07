import { columnLetter, type Cell } from './cells';
import { ENTITIES, LOG_TAB } from './entities';
import { adminGuide } from './guide';

/** The internet (or Google) cannot be reached: records stay queued and the run is retried later. */
export class OfflineError extends Error {}

export class SheetsError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export interface SheetsApi {
  create(title: string): Promise<string>;
  tabs(id: string): Promise<{ title: string; tabs: { title: string; sheetId: number }[] }>;
  /** Values of each range as rows of raw (unformatted) cells. */
  read(id: string, ranges: string[]): Promise<unknown[][][]>;
  write(id: string, data: { range: string; values: Cell[][] }[]): Promise<void>;
  append(id: string, tab: string, values: Cell[][]): Promise<void>;
  /** Spreadsheet-level changes: tabs, formatting, protection. */
  structure(id: string, requests: object[]): Promise<void>;
}

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const MAX_RETRIES = 4;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Google Sheets over plain HTTPS. Rate limits (429) and server errors are retried with a growing pause. */
export const googleSheets = (token: () => Promise<string>): SheetsApi => {
  const call = async <T>(method: string, url: string, body?: unknown): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetch(url, {
          method,
          headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (err) {
        if (err instanceof SheetsError) throw err;
        throw new OfflineError((err as Error).message);
      }
      if (res.ok) return (await res.json()) as T;
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
        await sleep(Math.min(Number(res.headers.get('retry-after')) * 1000 || 1500 * 2 ** attempt, 30_000));
        continue;
      }
      const detail = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      throw new SheetsError(res.status, detail?.error?.message ?? res.statusText);
    }
  };
  const enc = encodeURIComponent;
  return {
    create: async (title) => (await call<{ spreadsheetId: string }>('POST', BASE, { properties: { title } })).spreadsheetId,
    tabs: async (id) => {
      const meta = await call<{ properties: { title: string }; sheets: { properties: { title: string; sheetId: number } }[] }>('GET', `${BASE}/${id}?fields=properties.title,sheets.properties(sheetId,title)`);
      return { title: meta.properties.title, tabs: meta.sheets.map((s) => s.properties) };
    },
    read: async (id, ranges) => {
      const query = ranges.map((r) => `ranges=${enc(r)}`).join('&');
      const res = await call<{ valueRanges: { values?: unknown[][] }[] }>('GET', `${BASE}/${id}/values:batchGet?${query}&valueRenderOption=UNFORMATTED_VALUE`);
      return res.valueRanges.map((range) => range.values ?? []);
    },
    write: async (id, data) => void (await call('POST', `${BASE}/${id}/values:batchUpdate`, { valueInputOption: 'RAW', data })),
    append: async (id, tab, values) =>
      void (await call('POST', `${BASE}/${id}/values/${enc(`${tab}!A:A`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { values })),
    structure: async (id, requests) => void (await call('POST', `${BASE}/${id}:batchUpdate`, { requests })),
  };
};

export const parseSpreadsheetId = (input: string) => {
  const id = /\/spreadsheets\/d\/([\w-]+)/.exec(input)?.[1] ?? (/^[\w-]{20,}$/.test(input.trim()) ? input.trim() : null);
  if (!id) throw new SheetsError(400, 'That does not look like a Google Sheets link.');
  return id;
};

// ---------- preparing a spreadsheet ----------
export const GUIDE_TAB = 'ADMINISTRATION';
const HEADER_COLOR = { red: 0.89, green: 0.95, blue: 0.91 };

interface TabSpec {
  tab: string;
  columns: string[];
  editable: string[];
}

const TABS: TabSpec[] = [
  ...ENTITIES.map((e) => ({ tab: e.tab, columns: e.columns, editable: e.pull?.editable ?? [] })),
  { ...LOG_TAB, editable: [] },
];

/** Column ranges (as [start, end) indexes) that owners should not edit: all of them, or the non-editable ones. */
const systemColumnRanges = ({ columns, editable }: TabSpec) => {
  const ranges: [number, number][] = [];
  columns.forEach((column, i) => {
    if (editable.includes(column)) return;
    const last = ranges[ranges.length - 1];
    if (last && last[1] === i) last[1] = i + 1;
    else ranges.push([i, i + 1]);
  });
  return ranges;
};

const protect = (sheetId: number, description: string, range: object = {}) => ({
  addProtectedRange: { protectedRange: { range: { sheetId, ...range }, description, warningOnly: true } },
});

const styleTab = (sheetId: number, spec: TabSpec) => [
  { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { backgroundColor: HEADER_COLOR, textFormat: { bold: true } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } },
  { autoResizeDimensions: { dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: spec.columns.length } } },
  protect(sheetId, 'Column names: do not change.', { startRowIndex: 0, endRowIndex: 1 }),
  ...(spec.editable.length
    ? systemColumnRanges(spec).map(([start, end]) => protect(sheetId, 'Maintained by the POS: do not edit.', { startColumnIndex: start, endColumnIndex: end }))
    : [protect(sheetId, 'Sent by the POS: do not edit. Make changes in the POS.')]),
];

/**
 * Makes sure the spreadsheet has every tab with the expected header row. Missing tabs are created; existing data
 * is never touched, and a tab whose columns do not match is reported instead of overwritten.
 */
export const prepareSpreadsheet = async (api: SheetsApi, id: string, discardDefaultTab = false) => {
  const wanted = [{ tab: GUIDE_TAB, columns: ['guide'], editable: [] }, ...TABS];
  const first = await api.tabs(id);
  const existing = new Set(first.tabs.map((t) => t.title));
  const missing = wanted.filter((w) => !existing.has(w.tab));
  if (missing.length) {
    await api.structure(id, missing.map((w) => ({ addSheet: { properties: { title: w.tab, index: wanted.indexOf(w), gridProperties: { rowCount: 1000, columnCount: Math.max(w.columns.length, 2), frozenRowCount: w.tab === GUIDE_TAB ? 0 : 1 } } } })));
  }
  const { title, tabs } = await api.tabs(id);
  const sheetIds = new Map(tabs.map((t) => [t.title, t.sheetId]));

  const headers = await api.read(id, TABS.map((t) => `${t.tab}!1:1`));
  const fresh: TabSpec[] = [];
  TABS.forEach((spec, i) => {
    const current = (headers[i]?.[0] ?? []).map(String);
    if (!current.length) fresh.push(spec);
    else if (current.join('|') !== spec.columns.join('|')) throw new SheetsError(400, `The "${spec.tab}" sheet has different columns than this version of the POS expects. Rename or remove that sheet and try again.`);
  });

  if (fresh.length) await api.write(id, fresh.map((s) => ({ range: `${s.tab}!A1:${columnLetter(s.columns.length - 1)}1`, values: [s.columns] })));
  if (!existing.has(GUIDE_TAB)) {
    await api.write(id, [{ range: `${GUIDE_TAB}!A1`, values: adminGuide().map((line) => [line]) }]);
    await api.structure(id, [protect(sheetIds.get(GUIDE_TAB)!, 'Instructions for the owner.'), { updateDimensionProperties: { range: { sheetId: sheetIds.get(GUIDE_TAB)!, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 900 }, fields: 'pixelSize' } }]);
  }
  const styling = fresh.flatMap((spec) => styleTab(sheetIds.get(spec.tab)!, spec));
  const discard = discardDefaultTab && tabs.some((t) => t.sheetId === 0 && !wanted.some((w) => w.tab === t.title)) ? [{ deleteSheet: { sheetId: 0 } }] : [];
  if (styling.length || discard.length) await api.structure(id, [...styling, ...discard]);
  return title;
};
