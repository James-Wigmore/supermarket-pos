import { app } from 'electron';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import type { LicenseStatus } from '../bridge';
import { decide, machineCodeFrom, shopOfKey } from './license';
import { LICENSE_PUBLIC_KEY } from './licenseKey';

interface Stored { key?: string; firstSeen: number; existingInstall: boolean }

const file = () => join(app.getPath('userData'), 'license.json');

const machineSeed = () => {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8', windowsHide: true });
      const guid = /MachineGuid\s+REG_SZ\s+(\S+)/.exec(out)?.[1];
      if (guid) return guid;
    }
  } catch { /* fall back below */ }
  return hostname();
};

let machine = '';
export const machineCode = () => (machine ||= machineCodeFrom(machineSeed()));

const read = (): Stored | null => {
  try { return JSON.parse(readFileSync(file(), 'utf8')) as Stored; } catch { return null; }
};
const write = (data: Stored) => {
  mkdirSync(dirname(file()), { recursive: true });
  writeFileSync(file(), JSON.stringify(data));
};

/** Called once at start, before the database is opened: remembers when this copy was first seen and whether it already had shop data. */
export const initLicense = () => {
  if (read()) return;
  write({ firstSeen: Date.now(), existingInstall: existsSync(join(app.getPath('userData'), 'data', 'pos.db')) });
};

export const licenseStatus = (): LicenseStatus => {
  const code = machineCode();
  // Running from source (npm run desktop:dev) is never licensed: only installed copies are.
  if (!app.isPackaged) return { state: 'disabled', machineCode: code, shop: null, graceDaysLeft: null };
  const stored = read() ?? { firstSeen: Date.now(), existingInstall: false };
  const shop = stored.key && LICENSE_PUBLIC_KEY ? shopOfKey(stored.key, code, LICENSE_PUBLIC_KEY) : null;
  return { ...decide({ publicKey: LICENSE_PUBLIC_KEY, shop, existingInstall: stored.existingInstall, firstSeen: stored.firstSeen, now: Date.now() }), machineCode: code, shop };
};

export const activate = (key: string): LicenseStatus => {
  const shop = LICENSE_PUBLIC_KEY ? shopOfKey(key, machineCode(), LICENSE_PUBLIC_KEY) : null;
  if (!shop) throw new Error('This key is not valid for this computer. Check that you copied all of it, and that it was made for the code shown here.');
  const stored = read() ?? { firstSeen: Date.now(), existingInstall: false };
  write({ ...stored, key: key.replace(/\s+/g, '') });
  return licenseStatus();
};

/** True while the app may be used: activated, within the grace period, or licensing not set up. */
export const isLicensed = () => licenseStatus().state !== 'required';
