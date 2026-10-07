import { app, safeStorage } from 'electron';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DesktopSettings } from '../bridge';

interface Config extends DesktopSettings {
  /** Signs login tokens. Generated once per installation, never sent to the UI. */
  jwtSecret: string;
}

const configFile = () => join(app.getPath('userData'), 'config.json');

const defaults = (): Config => ({
  jwtSecret: randomBytes(48).toString('base64url'),
  printer: '',
  silentPrint: false,
  autoBackup: true,
  backupDir: join(app.getPath('documents'), 'Supermarket POS Backups'),
  lastBackupAt: null,
});

let current: Config | null = null;

/** Stored sealed (`enc:`) with Windows' own protection when available; plain text otherwise. */
const seal = (secret: string) => (safeStorage.isEncryptionAvailable() ? `enc:${safeStorage.encryptString(secret).toString('base64')}` : secret);
const unseal = (stored: string) => (stored.startsWith('enc:') ? safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64')) : stored);

const persist = (config: Config) => {
  current = config;
  writeFileSync(configFile(), JSON.stringify({ ...config, jwtSecret: seal(config.jwtSecret) }, null, 2));
  return config;
};

export const loadConfig = (): Config => {
  if (current) return current;
  let stored: Partial<Config> = {};
  try {
    stored = JSON.parse(readFileSync(configFile(), 'utf8')) as Partial<Config>;
  } catch {
    // First run, or an unreadable file: start from defaults.
  }
  const base = defaults();
  let secret: string | undefined;
  try {
    secret = stored.jwtSecret ? unseal(stored.jwtSecret) : undefined;
  } catch {
    // Unreadable (for example a different Windows user): a new secret only signs everyone out.
  }
  return persist({ ...base, ...stored, jwtSecret: secret ?? base.jwtSecret });
};

export const updateConfig = (patch: Partial<DesktopSettings>) => persist({ ...loadConfig(), ...patch });

export const publicSettings = (): DesktopSettings => {
  const { jwtSecret: _secret, ...settings } = loadConfig();
  return settings;
};
