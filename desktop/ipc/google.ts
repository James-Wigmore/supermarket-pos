import type { BrowserWindow } from 'electron';
import type { Backend } from '../main/backend';
import { connectGoogle, disconnectGoogle, googleStatus, importCredentials } from '../main/google';
import { handle } from './handle';
import { requireAdmin } from './system';

/** Google account connection. Administrator-only; credentials and tokens never reach the web page. */
export const registerGoogleIpc = (backend: Backend, getWindow: () => BrowserWindow | null) => {
  const admin = <T>(fn: () => T | Promise<T>) => async (_event: unknown, token: unknown) => {
    await requireAdmin(backend, token);
    return fn();
  };

  handle('google:status', admin(googleStatus));
  handle('google:connect', admin(connectGoogle));
  handle('google:disconnect', admin(disconnectGoogle));
  handle('google:import', async (_event, token: unknown) => {
    await requireAdmin(backend, token);
    const win = getWindow();
    return win ? importCredentials(win) : null;
  });
};
