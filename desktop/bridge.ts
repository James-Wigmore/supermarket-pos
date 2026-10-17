/** The only API the web UI gets from the desktop shell (`window.pos`). Types only: shared with the frontend. */

export interface ApiRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Path below `/api`, including any query string, e.g. `/products?search=milk`. */
  path: string;
  body?: unknown;
  token?: string | null;
}

export interface ApiResponse {
  status: number;
  contentType: string;
  disposition: string;
  body: Uint8Array<ArrayBuffer>;
}

export interface PrinterInfo {
  name: string;
  isDefault: boolean;
}

export interface DesktopSettings {
  printer: string;
  silentPrint: boolean;
  autoBackup: boolean;
  backupDir: string;
  lastBackupAt: string | null;
}

export type EditableDesktopSettings = Partial<Pick<DesktopSettings, 'printer' | 'silentPrint' | 'autoBackup'>>;

export interface GoogleStatus {
  hasCredentials: boolean;
  connected: boolean;
  /** False when Windows secure storage is unavailable: credentials could not be kept safely. */
  canStore: boolean;
}

export type UpdateState = 'disabled' | 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error';

export interface UpdateStatus {
  state: UpdateState;
  /** The version running now. */
  currentVersion: string;
  /** The newer version, once one was found. */
  version: string | null;
  /** 0 to 100 while downloading. */
  percent: number | null;
  /** When the last check finished (ISO time). */
  checkedAt: string | null;
  /** What went wrong, for the administrator. Only set when `state` is `error`. */
  error: string | null;
  /** Why updates cannot run here (`state` is `disabled`). */
  disabledReason: string | null;
}

/** Calls taking a `token` are administrator-only: the main process verifies it before acting. */
export interface PosBridge {
  request(req: ApiRequest): Promise<ApiResponse>;
  print(): Promise<void>;
  printers(): Promise<PrinterInfo[]>;
  getSettings(token: string): Promise<DesktopSettings>;
  saveSettings(token: string, patch: EditableDesktopSettings): Promise<DesktopSettings>;
  chooseBackupFolder(token: string): Promise<DesktopSettings | null>;
  /** Returns the backup file path. */
  backupNow(token: string): Promise<string>;
  /** Resolves with the restored file, or null if cancelled. The app restarts after a restore. */
  restore(token: string): Promise<string | null>;
  googleStatus(token: string): Promise<GoogleStatus>;
  /** Asks for the credentials file from Google Cloud; null if cancelled. */
  googleImportCredentials(token: string): Promise<GoogleStatus | null>;
  /** Opens the browser for the Google sign-in and resolves when it is finished. */
  googleConnect(token: string): Promise<GoogleStatus>;
  googleDisconnect(token: string): Promise<GoogleStatus>;
  /** Cheap and read-only: what the update checker knows right now. */
  updateStatus(): Promise<UpdateStatus>;
  updateCheck(token: string): Promise<UpdateStatus>;
  updateDownload(token: string): Promise<UpdateStatus>;
  /** Saves a safety backup, then closes the app, installs the downloaded update and reopens it. */
  updateInstall(token: string): Promise<UpdateStatus>;
}
