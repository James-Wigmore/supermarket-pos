import { defineConfig } from 'vitest/config';
import { TEST_DB_FILE } from './tests/db-path';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/global-setup.ts'],
    setupFiles: ['tests/setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: `file:${TEST_DB_FILE}`,
      JWT_SECRET: 'test-secret-test-secret-test-secret-123',
      BCRYPT_ROUNDS: '4',
      BARCODE_LOOKUP_PROVIDER: 'openfoodfacts',
    },
  },
});
