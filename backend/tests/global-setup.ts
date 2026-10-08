import { rmSync } from 'node:fs';
import { TEST_DB_FILE } from './db-path';

const cleanup = () => {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      rmSync(TEST_DB_FILE + suffix, {
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    } catch {
      // SQLite may still be locked briefly on Windows.
    }
  }
};

export default () => {
  cleanup();

  return () => {
    cleanup();
  };
};
