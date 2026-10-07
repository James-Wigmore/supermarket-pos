import { rmSync } from 'node:fs';
import { TEST_DB_FILE } from './db-path';

/** Removes the temporary SQLite test database (and its WAL files) after the run. */
export default () => () => {
  for (const suffix of ['', '-wal', '-shm']) rmSync(TEST_DB_FILE + suffix, { force: true });
};
