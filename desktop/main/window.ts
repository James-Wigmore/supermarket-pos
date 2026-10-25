import { BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { channel } from './channel';

/** Opens the main window with a locked-down renderer: no Node access, isolated context, our own pages only. */
export const createWindow = (url: string) => {
  const win = new BrowserWindow({
    width: 1366, height: 820, minWidth: 1024, minHeight: 640, show: false, autoHideMenuBar: true,
    backgroundColor: '#f6f3ea', title: channel.name,
    webPreferences: { preload: join(__dirname, '../preload/preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // The page title would replace the window title: keep the TEST marker visible.
  if (channel.isTest) win.on('page-title-updated', (event, title) => { event.preventDefault(); win.setTitle(`TEST - ${title}`); });
  win.once('ready-to-show', () => win.show());
  // Generated documents (PDF receipts, labels) open in a new window; the owner's Google spreadsheet opens in the browser.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith('https://docs.google.com/spreadsheets/')) void shell.openExternal(target);
    return { action: target.startsWith('blob:') ? 'allow' : 'deny' };
  });
  win.webContents.on('will-navigate', (event, target) => {
    if (!target.startsWith(url)) event.preventDefault();
  });
  void win.loadURL(url);
  return win;
};
