import { beforeAll } from 'vitest';
import { migrate } from '../src/lib/migrate';

beforeAll(async () => {
  await migrate();
});
