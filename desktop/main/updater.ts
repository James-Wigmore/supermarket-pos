import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { isTest } from './channel';
import type { UpdaterPort } from './updates';

/** Why updates cannot run in this copy of the app, or null when they can. */
export const updatesDisabledReason = () => {
  if (isTest) return 'This is a test build: it never looks for updates.';
  if (!app.isPackaged) return 'Updates only work in the installed app, not when it is run from source.';
  if (!existsSync(join(process.resourcesPath, 'app-update.yml'))) return 'This copy of the app was built without an update source, so it cannot look for updates.';
  return null;
};

const inert: UpdaterPort = {
  subscribe: () => undefined,
  check: () => Promise.resolve(),
  download: () => Promise.resolve(),
  quitAndInstall: () => undefined,
};

/** Connects the update library to the shell. When updates are disabled the library is never touched. */
export const createUpdaterPort = (enabled: boolean): UpdaterPort => {
  if (!enabled) return inert;
  // The administrator decides when to download and when to restart: nothing is downloaded or installed on its own.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = false;
  return {
    subscribe: (handler) => {
      autoUpdater.on('checking-for-update', () => handler({ type: 'checking' }));
      autoUpdater.on('update-available', (info) => handler({ type: 'available', version: info.version }));
      autoUpdater.on('update-not-available', () => handler({ type: 'none' }));
      autoUpdater.on('download-progress', (progress) => handler({ type: 'progress', percent: progress.percent }));
      autoUpdater.on('update-downloaded', (info) => handler({ type: 'downloaded', version: info.version }));
      autoUpdater.on('error', (err) => handler({ type: 'error', message: err instanceof Error ? err.message : String(err) }));
    },
    // The library reports a failure both as an 'error' event and by rejecting; the event is the one that is used.
    check: async () => { await autoUpdater.checkForUpdates().catch(() => undefined); },
    download: async () => { await autoUpdater.downloadUpdate().catch(() => undefined); },
    // Silent install, then start the app again.
    quitAndInstall: () => autoUpdater.quitAndInstall(true, true),
  };
};
