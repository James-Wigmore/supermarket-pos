import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUpdateService, type UpdaterEvent } from './updates';

const NOW = new Date('2026-10-20T08:00:00.000Z');

const setup = (options: { disabledReason?: string | null; online?: boolean; backup?: () => Promise<unknown> } = {}) => {
  let emit: (event: UpdaterEvent) => void = () => undefined;
  const port = {
    subscribe: vi.fn((handler: (event: UpdaterEvent) => void) => { emit = handler; }),
    check: vi.fn(async () => undefined),
    download: vi.fn(async () => undefined),
    quitAndInstall: vi.fn(),
  };
  const network = { online: options.online ?? true };
  const backup = vi.fn(options.backup ?? (async () => 'backup.db'));
  const service = createUpdateService({
    port, currentVersion: '1.0.0', disabledReason: options.disabledReason ?? null, isOnline: () => network.online, beforeInstall: backup, now: () => NOW,
  });
  const found = (version = '1.1.0') => port.check.mockImplementation(async () => { emit({ type: 'checking' }); emit({ type: 'available', version }); });
  const nothingNew = () => port.check.mockImplementation(async () => { emit({ type: 'checking' }); emit({ type: 'none' }); });
  const downloads = (version = '1.1.0') => port.download.mockImplementation(async () => { emit({ type: 'progress', percent: 41.6 }); emit({ type: 'downloaded', version }); });
  return { service, port, backup, network, emit: (event: UpdaterEvent) => emit(event), found, nothingNew, downloads };
};

describe('when updates cannot run (not installed, or built without an update source)', () => {
  it('says why and never touches the update library', async () => {
    const t = setup({ disabledReason: 'Built without an update source.' });
    expect(t.service.status()).toMatchObject({ state: 'disabled', disabledReason: 'Built without an update source.', currentVersion: '1.0.0' });
    await t.service.check(true);
    await expect(t.service.download()).rejects.toThrow(/no update to download/i);
    expect(t.port.check).not.toHaveBeenCalled();
    expect(t.service.status().state).toBe('disabled');
  });
});

describe('looking for updates', () => {
  it('reports a newer version and when it looked', async () => {
    const t = setup();
    t.found('1.2.0');
    expect(await t.service.check(true)).toMatchObject({ state: 'available', version: '1.2.0', checkedAt: NOW.toISOString(), error: null });
  });

  it('goes back to idle when already up to date', async () => {
    const t = setup();
    t.nothingNew();
    expect(await t.service.check(true)).toMatchObject({ state: 'idle', version: null, checkedAt: NOW.toISOString() });
  });

  it('does not stack requests: a second check while one is running does nothing extra', async () => {
    const t = setup();
    t.found();
    await Promise.all([t.service.check(true), t.service.check(true)]);
    expect(t.port.check).toHaveBeenCalledTimes(1);
  });

  it('stays quiet in the background when the internet is down, and says so when asked by hand', async () => {
    const t = setup({ online: false });
    expect((await t.service.check()).state).toBe('idle');
    expect(t.port.check).not.toHaveBeenCalled();
    expect(await t.service.check(true)).toMatchObject({ state: 'error', error: expect.stringMatching(/no internet/i) });
  });

  it('keeps a failed background check out of sight and does not claim it checked', async () => {
    const t = setup();
    t.port.check.mockImplementation(async () => { t.emit({ type: 'checking' }); t.emit({ type: 'error', message: 'getaddrinfo ENOTFOUND github.com' }); });
    expect(await t.service.check()).toMatchObject({ state: 'idle', error: null, checkedAt: null });
  });

  it('shows a failed manual check, with network errors in plain words', async () => {
    const t = setup();
    t.port.check.mockImplementation(async () => { t.emit({ type: 'checking' }); t.emit({ type: 'error', message: 'net::ERR_INTERNET_DISCONNECTED' }); });
    expect(await t.service.check(true)).toMatchObject({ state: 'error', error: expect.stringMatching(/no internet/i), checkedAt: null });
    t.port.check.mockImplementation(async () => { t.emit({ type: 'error', message: 'HttpError: 404\nstack line' }); });
    expect((await t.service.check(true)).error).toBe('HttpError: 404');
  });

  it('a later successful check clears an earlier error', async () => {
    const t = setup();
    t.port.check.mockImplementationOnce(async () => { t.emit({ type: 'error', message: 'HttpError: 404' }); });
    await t.service.check(true);
    t.nothingNew();
    expect(await t.service.check(true)).toMatchObject({ state: 'idle', error: null });
  });
});

describe('downloading', () => {
  it('only downloads an update that was found', async () => {
    const t = setup();
    await expect(t.service.download()).rejects.toThrow(/no update to download/i);
    expect(t.port.download).not.toHaveBeenCalled();
  });

  it('shows progress while downloading and ends as downloaded', async () => {
    const t = setup();
    t.found();
    await t.service.check(true);
    let during: unknown;
    t.port.download.mockImplementation(async () => { t.emit({ type: 'progress', percent: 41.6 }); during = t.service.status(); t.emit({ type: 'downloaded', version: '1.1.0' }); });
    const done = await t.service.download();
    expect(during).toMatchObject({ state: 'downloading', percent: 42 });
    expect(done).toMatchObject({ state: 'downloaded', version: '1.1.0', percent: null });
  });

  it('keeps the found version after a failed download so it can be retried', async () => {
    const t = setup();
    t.found('1.3.0');
    await t.service.check(true);
    t.port.download.mockImplementationOnce(async () => { t.emit({ type: 'error', message: 'read ECONNRESET' }); });
    expect(await t.service.download()).toMatchObject({ state: 'error', version: '1.3.0', error: expect.stringMatching(/no internet/i) });
    t.downloads('1.3.0');
    expect(await t.service.download()).toMatchObject({ state: 'downloaded', version: '1.3.0', error: null });
  });

  it('does not start a download while offline, keeps the found version, and works once the connection is back', async () => {
    const t = setup();
    t.found('1.1.0');
    await t.service.check(true);
    t.network.online = false;
    expect(await t.service.download()).toMatchObject({ state: 'error', version: '1.1.0', error: expect.stringMatching(/no internet/i) });
    expect(t.port.download).not.toHaveBeenCalled();
    t.network.online = true;
    t.downloads();
    expect((await t.service.download()).state).toBe('downloaded');
  });

  it('reports a download that ends without finishing', async () => {
    const t = setup();
    t.found();
    await t.service.check(true);
    expect(await t.service.download()).toMatchObject({ state: 'error', error: expect.stringMatching(/did not finish/i) });
  });

  it('does not check again while an update is downloading or ready', async () => {
    const t = setup();
    t.found();
    await t.service.check(true);
    t.downloads();
    await t.service.download();
    t.port.check.mockClear();
    await t.service.check(true);
    expect(t.port.check).not.toHaveBeenCalled();
    expect(t.service.status().state).toBe('downloaded');
  });
});

describe('installing', () => {
  const downloaded = async (options?: Parameters<typeof setup>[0]) => {
    const t = setup(options);
    t.found();
    await t.service.check(true);
    t.downloads();
    await t.service.download();
    return t;
  };

  it('saves a backup first and only then starts the installer', async () => {
    const order: string[] = [];
    const t = await downloaded({ backup: async () => { order.push('backup'); } });
    t.port.quitAndInstall.mockImplementation(() => { order.push('install'); });
    await t.service.install();
    expect(order).toEqual(['backup', 'install']);
  });

  it('does not install when the safety backup fails, and keeps the update ready', async () => {
    const t = await downloaded({ backup: async () => { throw new Error('disk full'); } });
    await expect(t.service.install()).rejects.toThrow(/safety backup failed: disk full/i);
    expect(t.port.quitAndInstall).not.toHaveBeenCalled();
    expect(t.service.status().state).toBe('downloaded');
  });

  it('refuses to install before an update has been downloaded', async () => {
    const t = setup();
    t.found();
    await t.service.check(true);
    await expect(t.service.install()).rejects.toThrow(/no update has been downloaded/i);
    expect(t.backup).not.toHaveBeenCalled();
    expect(t.port.quitAndInstall).not.toHaveBeenCalled();
  });

  it('ignores a double click: one backup, one install', async () => {
    const t = await downloaded();
    await Promise.all([t.service.install(), t.service.install()]);
    expect(t.backup).toHaveBeenCalledTimes(1);
    expect(t.port.quitAndInstall).toHaveBeenCalledTimes(1);
  });
});

describe('the background schedule', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('checks shortly after start, then every six hours, and can be stopped', async () => {
    const t = setup();
    t.nothingNew();
    const stop = t.service.schedule();
    await vi.advanceTimersByTimeAsync(44_000);
    expect(t.port.check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(t.port.check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(6 * 3_600_000);
    expect(t.port.check).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(12 * 3_600_000);
    expect(t.port.check).toHaveBeenCalledTimes(2);
  });
});
