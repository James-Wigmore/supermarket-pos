import { app, BrowserWindow, dialog, Menu, net, session } from 'electron';
import { join } from 'node:path';
import { registerApiIpc } from '../ipc/api';
import { trustOrigin } from '../ipc/handle';
import { registerGoogleIpc } from '../ipc/google';
import { registerSystemIpc } from '../ipc/system';
import { registerUpdateIpc } from '../ipc/updates';
import { backupBeforeSync, createBackup, startAutoBackup } from './backup';
import { startBackend, type Backend } from './backend';
import { accessToken, googleStatus } from './google';
import { appRoot } from './paths';
import { APP_URL, registerAppScheme, serveApp } from './protocol';
import { createUpdaterPort, updatesDisabledReason } from './updater';
import { createUpdateService } from './updates';
import { createWindow } from './window';

// Fixed folder name (no spaces) so user data survives updates and renames of the app.
app.setPath('userData', join(app.getPath('appData'), 'supermarket-pos'));
app.setAppUserModelId('com.supermarketpos.desktop'); // same as the installer's appId: correct taskbar grouping and shortcuts
registerAppScheme();

let backend: Backend | null = null;
let win: BrowserWindow | null = null;
let closing = false;

const start = async () => {
  if (app.isPackaged) Menu.setApplicationMenu(null);
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, allow) => allow(false));
  serveApp(join(appRoot(), 'frontend'));

  try {
    backend = await startBackend();
  } catch (err) {
    dialog.showErrorBox('Supermarket POS could not start', err instanceof Error ? err.message : String(err));
    app.quit();
    return;
  }

  // POS_DEV_URL lets developers load the Vite dev server (hot reload) instead of the built UI.
  const url = process.env.POS_DEV_URL ?? APP_URL;
  trustOrigin(url);
  registerApiIpc(backend);
  registerSystemIpc(backend, () => win);
  registerGoogleIpc(backend, () => win);
  startAutoBackup(backend);
  const current = backend;
  backend.sync.configureSync({
    accessToken,
    isConnected: () => googleStatus().connected,
    isOnline: () => net.isOnline(),
    backup: () => backupBeforeSync(current),
  });
  backend.sync.startSyncScheduler();
  const disabledReason = updatesDisabledReason();
  const updates = createUpdateService({
    port: createUpdaterPort(disabledReason === null),
    currentVersion: app.getVersion(),
    disabledReason,
    isOnline: () => net.isOnline(),
    beforeInstall: () => createBackup(current, 'pre-update'),
  });
  registerUpdateIpc(backend, updates);
  updates.schedule();
  win = createWindow(url);
};

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win?.isMinimized()) win.restore();
    win?.focus();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (event) => {
    if (closing || !backend) return;
    event.preventDefault();
    closing = true;
    void backend.close().finally(() => app.quit());
  });
  void app.whenReady().then(start);
}
