import { dialog, type BrowserWindow, type WebContents } from 'electron';
import type { EditableDesktopSettings, PrinterInfo } from '../bridge';
import { createBackup, restoreBackup } from '../main/backup';
import type { Backend } from '../main/backend';
import { loadConfig, publicSettings, updateConfig } from '../main/config';
import { dispatch } from './api';
import { handle } from './handle';

/** Confirms the token belongs to a signed-in user who may manage settings (same rule as the Settings page). */
export const requireAdmin = async (backend: Backend, token: unknown) => {
  if (typeof token !== 'string' || !token) throw new Error('Please sign in again.');
  const res = await dispatch(backend, { method: 'GET', path: '/auth/me', token });
  const me = JSON.parse(Buffer.from(res.body).toString('utf8')) as { permissions?: string[] };
  if (res.status !== 200 || !me.permissions?.includes('settings:manage')) throw new Error('Administrator permission required.');
};

const printPage = (contents: WebContents) =>
  new Promise<void>((resolve, reject) => {
    const { silentPrint, printer } = loadConfig();
    contents.print({ silent: silentPrint, deviceName: printer || undefined, printBackground: false }, (ok, reason) =>
      ok || reason === 'cancelled' ? resolve() : reject(new Error(reason)));
  });

const editable = (patch: unknown): EditableDesktopSettings => {
  const p = (patch ?? {}) as Record<string, unknown>;
  return {
    ...(typeof p.printer === 'string' ? { printer: p.printer } : {}),
    ...(typeof p.silentPrint === 'boolean' ? { silentPrint: p.silentPrint } : {}),
    ...(typeof p.autoBackup === 'boolean' ? { autoBackup: p.autoBackup } : {}),
  };
};

export const registerSystemIpc = (backend: Backend, getWindow: () => BrowserWindow | null) => {
  const admin = <T>(fn: () => T | Promise<T>) => async (_event: unknown, token: unknown) => {
    await requireAdmin(backend, token);
    return fn();
  };

  handle('system:print', (event) => printPage(event.sender));

  handle('system:printers', async (event): Promise<PrinterInfo[]> =>
    (await event.sender.getPrintersAsync()).map((p) => ({ name: p.name, isDefault: Boolean((p as { isDefault?: boolean }).isDefault) })));

  handle('system:get-settings', admin(publicSettings));

  handle('system:save-settings', async (_event, token: unknown, patch: unknown) => {
    await requireAdmin(backend, token);
    updateConfig(editable(patch));
    return publicSettings();
  });

  handle('system:choose-folder', async (_event, token: unknown) => {
    await requireAdmin(backend, token);
    const win = getWindow();
    const options = { title: 'Choose where backups are saved', defaultPath: loadConfig().backupDir, properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[] };
    const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    const [dir] = picked.filePaths;
    if (picked.canceled || !dir) return null;
    updateConfig({ backupDir: dir });
    return publicSettings();
  });

  handle('system:backup', admin(() => createBackup(backend, 'manual')));

  handle('system:restore', async (_event, token: unknown) => {
    await requireAdmin(backend, token);
    const win = getWindow();
    return win ? restoreBackup(backend, win) : null;
  });
};
