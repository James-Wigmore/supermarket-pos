import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PosBridge, UpdateStatus } from '../../../desktop/bridge';
import { tokenStore } from '../lib/api';
import { renderApp, stubBrowser } from '../test/utils';
import { UpdateBanner } from './UpdateBanner';

const auth = vi.hoisted(() => ({ isAdmin: true }));
vi.mock('../lib/auth', () => ({ useAuth: () => ({ canAny: () => auth.isAdmin }) }));

const status = (over: Partial<UpdateStatus> = {}): UpdateStatus => ({
  state: 'idle', currentVersion: '1.0.0', version: null, percent: null, checkedAt: null, error: null, disabledReason: null, ...over,
});

const bridge = (current: UpdateStatus) => {
  const pos = { updateStatus: vi.fn(async () => current), updateCheck: vi.fn(), updateDownload: vi.fn(), updateInstall: vi.fn() };
  window.pos = pos as unknown as PosBridge;
  return pos;
};

beforeEach(() => { stubBrowser(); auth.isAdmin = true; tokenStore.set('admin-token'); });
afterEach(() => { cleanup(); delete window.pos; tokenStore.clear(); vi.restoreAllMocks(); });

describe('who sees the update banner', () => {
  it('is never shown, or asked for, in a browser', () => {
    const { container } = renderApp(<UpdateBanner />);
    expect(container.textContent).toBe('');
  });

  it('is hidden from people who cannot manage settings, even when an update is waiting', async () => {
    auth.isAdmin = false;
    const pos = bridge(status({ state: 'available', version: '1.1.0' }));
    const { container } = renderApp(<UpdateBanner />);
    await waitFor(() => expect(pos.updateStatus).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it.each(['idle', 'checking', 'disabled'] as const)('stays hidden while the state is %s', async (state) => {
    const pos = bridge(status({ state, disabledReason: state === 'disabled' ? 'Not installed.' : null }));
    const { container } = renderApp(<UpdateBanner />);
    await waitFor(() => expect(pos.updateStatus).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('stays hidden for an error that has nothing to retry (for example a failed background check)', async () => {
    const pos = bridge(status({ state: 'error', error: 'No internet' }));
    const { container } = renderApp(<UpdateBanner />);
    await waitFor(() => expect(pos.updateStatus).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });
});

describe('downloading an update', () => {
  it('offers the new version, downloads it on request with the administrator token, then offers to install', async () => {
    const pos = bridge(status({ state: 'available', version: '1.1.0' }));
    pos.updateDownload.mockResolvedValue(status({ state: 'downloaded', version: '1.1.0' }));
    renderApp(<UpdateBanner />);
    expect(await screen.findByText('Version 1.1.0 is available. You have 1.0.0.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Download update' }));
    expect(await screen.findByText('Version 1.1.0 is ready to install.')).toBeTruthy();
    expect(pos.updateDownload).toHaveBeenCalledWith('admin-token');
    expect(screen.queryByRole('button', { name: 'Download update' })).toBeNull();
  });

  it('shows the progress while it downloads', async () => {
    bridge(status({ state: 'downloading', version: '1.1.0', percent: 42 }));
    renderApp(<UpdateBanner />);
    expect(await screen.findByText('Downloading version 1.1.0… 42%')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Download progress' }).getAttribute('aria-valuenow')).toBe('42');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows a failed download with the reason and lets the administrator try again', async () => {
    const pos = bridge(status({ state: 'error', version: '1.1.0', error: 'There is no internet connection right now. Try again when it is back.' }));
    pos.updateDownload.mockResolvedValue(status({ state: 'downloaded', version: '1.1.0' }));
    renderApp(<UpdateBanner />);
    expect(await screen.findByText(/no internet connection/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Version 1.1.0 is ready to install.')).toBeTruthy();
    expect(pos.updateDownload).toHaveBeenCalledWith('admin-token');
  });
});

describe('installing an update', () => {
  const ready = () => bridge(status({ state: 'downloaded', version: '1.1.0' }));
  const openConfirm = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Restart and install' }));
    return within(await screen.findByRole('dialog'));
  };

  it('asks first, warning that nobody can sell meanwhile, and does nothing if the answer is not now', async () => {
    const pos = ready();
    renderApp(<UpdateBanner />);
    const dialog = await openConfirm();
    expect(dialog.getByText('Install version 1.1.0?')).toBeTruthy();
    expect(dialog.getByText(/nobody can sell during that time/i)).toBeTruthy();
    fireEvent.click(dialog.getByRole('button', { name: 'Not now' }));
    expect(pos.updateInstall).not.toHaveBeenCalled();
  });

  it('installs once confirmed, using the administrator token, and says a backup is being saved', async () => {
    const pos = ready();
    pos.updateInstall.mockReturnValue(new Promise(() => undefined)); // the app closes, so this never answers
    renderApp(<UpdateBanner />);
    const dialog = await openConfirm();
    fireEvent.click(dialog.getByRole('button', { name: 'Restart and install' }));
    await waitFor(() => expect(pos.updateInstall).toHaveBeenCalledWith('admin-token'));
    expect(await screen.findByText(/saving a backup, then installing/i)).toBeTruthy();
  });

  it('shows why nothing was installed when the safety backup fails, and keeps the update ready', async () => {
    const pos = ready();
    pos.updateInstall.mockRejectedValue(new Error("Error invoking remote method 'update:install': Error: The update was not installed because the safety backup failed: disk full"));
    renderApp(<UpdateBanner />);
    const dialog = await openConfirm();
    fireEvent.click(dialog.getByRole('button', { name: 'Restart and install' }));
    expect(await screen.findByText('The update was not installed because the safety backup failed: disk full')).toBeTruthy();
    expect(screen.getByText('Version 1.1.0 is ready to install.')).toBeTruthy();
  });
});
