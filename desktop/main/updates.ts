import type { UpdateState, UpdateStatus } from '../bridge';

/** What the update library reports, reduced to what the shell cares about. */
export type UpdaterEvent =
  | { type: 'checking' }
  | { type: 'available'; version: string }
  | { type: 'none' }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; message: string };

/** The only parts of the update library the service uses (see `updater.ts`). Errors are reported as events, not thrown. */
export interface UpdaterPort {
  subscribe(handler: (event: UpdaterEvent) => void): void;
  check(): Promise<void>;
  download(): Promise<void>;
  /** Starts the installer and quits the app. */
  quitAndInstall(): void;
}

export interface UpdateServiceOptions {
  port: UpdaterPort;
  currentVersion: string;
  /** Why updates cannot run in this build (not installed, no feed); null when they can. */
  disabledReason: string | null;
  isOnline: () => boolean;
  /** Saves a safety copy of the data. If it fails the update is not installed. */
  beforeInstall: () => Promise<unknown>;
  now?: () => Date;
}

export interface UpdateService {
  status(): UpdateStatus;
  /** `manual` shows problems to the administrator; the background timer stays quiet when the internet is down. */
  check(manual?: boolean): Promise<UpdateStatus>;
  download(): Promise<UpdateStatus>;
  install(): Promise<UpdateStatus>;
  /** First check shortly after start, then regularly. Returns a function that stops it. */
  schedule(firstMs?: number, everyMs?: number): () => void;
}

const OFFLINE = 'There is no internet connection right now. Try again when it is back.';
const readable = (message: string) => (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|ERR_INTERNET|ERR_NETWORK|net::/i.test(message) ? OFFLINE : message.split('\n')[0]!.slice(0, 300));

export const createUpdateService = ({ port, currentVersion, disabledReason, isOnline, beforeInstall, now = () => new Date() }: UpdateServiceOptions): UpdateService => {
  let state: UpdateState = disabledReason ? 'disabled' : 'idle';
  let version: string | null = null;
  let percent: number | null = null;
  let checkedAt: string | null = null;
  let error: string | null = null;
  let busy = false; // a check, a download or an install is running
  let quiet = false; // a background check: it never shows "checking" or an error to the administrator
  let answered = false; // the running check got an answer from the update server

  const set = (next: UpdateState) => { state = next; error = null; };
  /** Reads the current state; needed after an `await`, where the compiler cannot see that events changed it. */
  const is = (...states: UpdateState[]) => states.includes(state);
  const fail = (message: string) => { state = 'error'; error = readable(message); };

  const status = (): UpdateStatus => ({ state, currentVersion, version, percent: state === 'downloading' ? percent : null, checkedAt, error, disabledReason });

  port.subscribe((event) => {
    if (state === 'disabled') return;
    switch (event.type) {
      case 'checking': if (!quiet) set('checking'); return;
      case 'available': answered = true; version = event.version; return set('available');
      case 'none': answered = true; version = null; return set('idle');
      case 'progress': percent = Math.round(event.percent); return;
      case 'downloaded': version = event.version; return set('downloaded');
      case 'error': if (!quiet) fail(event.message);
    }
  });

  /** One thing at a time: a second request while one is running just reports the current status. */
  const run = async (work: () => Promise<void>) => {
    if (busy) return status();
    busy = true;
    try {
      await work();
    } finally {
      busy = false;
    }
    return status();
  };

  const check = (manual = false) => run(async () => {
    if (state === 'disabled' || state === 'downloading' || state === 'downloaded') return;
    if (!isOnline()) {
      if (manual) fail(OFFLINE);
      return;
    }
    quiet = !manual;
    answered = false;
    try {
      await port.check();
    } finally {
      quiet = false;
    }
    if (is('checking')) set('idle');
    if (answered) checkedAt = now().toISOString();
  });

  const download = () => run(async () => {
    if (state !== 'available' && !(state === 'error' && version)) throw new Error('There is no update to download.');
    if (!isOnline()) return fail(OFFLINE);
    percent = 0;
    set('downloading');
    await port.download();
    if (is('downloading')) fail('The download did not finish. Try again.');
  });

  const install = () => run(async () => {
    if (state !== 'downloaded') throw new Error('No update has been downloaded yet.');
    try {
      await beforeInstall();
    } catch (err) {
      throw new Error(`The update was not installed because the safety backup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    port.quitAndInstall();
  });

  const schedule = (firstMs = 45_000, everyMs = 6 * 3_600_000) => {
    const first = setTimeout(() => void check(), firstMs);
    const repeat = setInterval(() => void check(), everyMs);
    return () => { clearTimeout(first); clearInterval(repeat); };
  };

  return { status, check, download, install, schedule };
};
