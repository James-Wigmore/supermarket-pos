import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** One throwaway SQLite file per test run. */
export const TEST_DB_FILE = join(tmpdir(), `pos-test-${process.pid}.db`).replaceAll('\\', '/');
