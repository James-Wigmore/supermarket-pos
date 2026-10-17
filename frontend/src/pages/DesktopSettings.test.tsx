import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopSettings as Settings, PosBridge, UpdateStatus } from '../../../desktop/bridge';
import { tokenStore } from '../lib/api';
import { renderApp, stubBrowser } from '../test/utils';
import { DesktopSettings } from './DesktopSettings';

const settings: Settings = { printer: '', silentPrint: false, autoBackup: true, backupDir: 'C:\\Backups', lastBackupAt: null };
const status = (over: Partial<UpdateStatus> = {}): UpdateStatus => ({
  state: 'idle', currentVersion: '1.0.0', version: null, percent: null, checkedAt: null, error: null, disabledReason: null, ...over,
});

const bridge = (current: UpdateStatus) => {
  const pos = {
    getSettings: vi.fn(async () => settings), printers: vi.fn(async () => []),
    updateStatus: vi.fn(async () => current), updateCheck: vi.fn(), updateDownload: vi.fn(), updateInstall: vi.fn(),
  };
  window.pos = pos as unknown as PosBridge;
  return pos;
};

beforeEach(() => { stubBrowser(); tokenStore.set('admin-token'); });
afterEach(() => { cleanup(); delete window.pos; tokenStore.clear(); vi.restoreAllMocks(); });

describe('app updates in the desktop settings', () => {
  it('shows the installed version and when updates were last checked', async () => {
    bridge(status({ checkedAt: '2026-10-20T08:00:00.000Z' }));
    renderApp(<DesktopSettings />);
    expect(await screen.findByText('App updates')).toBeTruthy();
    expect((await screen.findByText('1.0.0')).tagName).toBe('B');
    expect(screen.getByText('You have the latest version.')).toBeTruthy();
    expect(screen.getByText(/last checked:/i)).toBeTruthy();
    expect(screen.getByText(/nothing is downloaded or installed until you choose/i)).toBeTruthy();
  });

  it('checks for updates on request and shows what it found', async () => {
    const pos = bridge(status());
    pos.updateCheck.mockResolvedValue(status({ state: 'available', version: '1.2.0' }));
    renderApp(<DesktopSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check for updates' }));
    expect(await screen.findByText('Version 1.2.0 is available. You have 1.0.0.')).toBeTruthy();
    expect(pos.updateCheck).toHaveBeenCalledWith('admin-token');
  });

  it('says so, in words, when the check fails because there is no internet', async () => {
    const pos = bridge(status());
    pos.updateCheck.mockResolvedValue(status({ state: 'error', error: 'There is no internet connection right now. Try again when it is back.' }));
    renderApp(<DesktopSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check for updates' }));
    expect(await screen.findByText(/no internet connection/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy();
  });

  it('explains why updates are off in a copy that was built without an update source, and offers no buttons for it', async () => {
    bridge(status({ state: 'disabled', disabledReason: 'This copy of the app was built without an update source, so it cannot look for updates.' }));
    renderApp(<DesktopSettings />);
    expect(await screen.findByText(/built without an update source/i)).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('button', { name: /check|download|install/i })).toBeNull());
  });
});
