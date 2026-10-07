import { contextBridge, ipcRenderer } from 'electron';
import type { PosBridge } from '../bridge';

// Sandboxed preload: only `electron` can be required, so channel names are spelled out here.
const call = <T>(channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args) as Promise<T>;

const bridge: PosBridge = {
  request: (req) => call('api:request', req),
  print: () => call('system:print'),
  printers: () => call('system:printers'),
  getSettings: (token) => call('system:get-settings', token),
  saveSettings: (token, patch) => call('system:save-settings', token, patch),
  chooseBackupFolder: (token) => call('system:choose-folder', token),
  backupNow: (token) => call('system:backup', token),
  restore: (token) => call('system:restore', token),
  googleStatus: (token) => call('google:status', token),
  googleImportCredentials: (token) => call('google:import', token),
  googleConnect: (token) => call('google:connect', token),
  googleDisconnect: (token) => call('google:disconnect', token),
};

contextBridge.exposeInMainWorld('pos', bridge);
