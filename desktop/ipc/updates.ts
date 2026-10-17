import type { UpdateStatus } from '../bridge';
import type { Backend } from '../main/backend';
import type { UpdateService } from '../main/updates';
import { handle } from './handle';
import { requireAdmin } from './system';

/** Everyone may see the status (it holds nothing sensitive); checking, downloading and installing are administrator-only. */
export const registerUpdateIpc = (backend: Backend, updates: UpdateService) => {
  const admin = (action: () => Promise<UpdateStatus>) => async (_event: unknown, token: unknown) => {
    await requireAdmin(backend, token);
    return action();
  };
  handle('update:status', () => updates.status());
  handle('update:check', admin(() => updates.check(true)));
  handle('update:download', admin(() => updates.download()));
  handle('update:install', admin(() => updates.install()));
};
