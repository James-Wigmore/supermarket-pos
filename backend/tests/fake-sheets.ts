import type { Cell } from '../src/sync/cells';
import { OfflineError, SheetsError, type SheetsApi } from '../src/sync/sheets';

/** In-memory Google Sheets: tabs are arrays of rows, the header being row 0. */
export class FakeSheets implements SheetsApi {
  tabs_ = new Map<string, unknown[][]>();
  /** Set to make the next write/append fail once. */
  failNext: 'offline' | 'rejected' | null = null;

  private rows(tab: string) {
    const rows = this.tabs_.get(tab);
    if (!rows) throw new SheetsError(400, `Unable to parse range: ${tab}`);
    return rows;
  }

  private maybeFail() {
    const failure = this.failNext;
    this.failNext = null;
    if (failure === 'offline') throw new OfflineError('network down');
    if (failure === 'rejected') throw new SheetsError(400, 'Invalid values');
  }

  async create() {
    return 'fake-spreadsheet';
  }

  async tabs() {
    return { title: 'Fake POS', tabs: [...this.tabs_.keys()].map((title, i) => ({ title, sheetId: i + 1 })) };
  }

  async read(_id: string, ranges: string[]) {
    return ranges.map((range) => {
      const [tab, cols] = range.split('!') as [string, string];
      const rows = this.rows(tab);
      if (cols === '1:1') return rows.slice(0, 1);
      const last = /^A:([A-Z])$/.exec(cols)?.[1];
      if (!last) throw new Error(`unsupported range ${range}`);
      return rows.map((row) => row.slice(0, last.charCodeAt(0) - 64));
    });
  }

  async write(_id: string, data: { range: string; values: Cell[][] }[]) {
    this.maybeFail();
    for (const { range, values } of data) {
      const [, tab, row] = /^(\w+)!A(\d+)/.exec(range)!;
      const rows = this.rows(tab!);
      const index = Number(row) - 1;
      while (rows.length < index) rows.push([]);
      values.forEach((row, i) => (rows[index + i] = [...row]));
    }
  }

  async append(_id: string, tab: string, values: Cell[][]) {
    this.maybeFail();
    this.rows(tab).push(...values.map((row) => [...row]));
  }

  async structure(_id: string, requests: object[]) {
    for (const request of requests) {
      const added = (request as { addSheet?: { properties: { title: string } } }).addSheet;
      if (added) this.tabs_.set(added.properties.title, []);
    }
  }

  // ---- helpers for tests ----
  table(tab: string) {
    return this.rows(tab).slice(1);
  }

  find(tab: string, id: string) {
    return this.rows(tab).find((row, i) => i > 0 && row[0] === id);
  }

  cell(tab: string, id: string, column: string) {
    return this.find(tab, id)?.[(this.rows(tab)[0] as string[]).indexOf(column)];
  }

  edit(tab: string, id: string, column: string, value: Cell) {
    this.find(tab, id)![(this.rows(tab)[0] as string[]).indexOf(column)] = value;
  }

  addRow(tab: string, values: Record<string, Cell>) {
    const header = this.rows(tab)[0] as string[];
    this.rows(tab).push(header.map((column) => values[column] ?? ''));
  }
}
