import { createHash, createPublicKey, verify } from 'node:crypto';

/** Pure licence rules (no Electron), so they can be tested. A key is `<payload>.<signature>`, both base64url; the payload names the PC it was issued for. */
export const GRACE_DAYS = 14;

export type LicenseState = 'ok' | 'grace' | 'required' | 'disabled';

/** The code the shop reads out to the developer: a short fingerprint of this PC, the same every time on the same PC. */
export const machineCodeFrom = (seed: string) =>
  createHash('sha256').update(`pos-machine:${seed.trim().toLowerCase()}`).digest('hex').slice(0, 16).toUpperCase().match(/.{4}/g)!.join('-');

const b64 = (text: string) => Buffer.from(text, 'base64url');

/** The shop name the key was issued to, when the key is genuine (signed by us) and made for this PC. */
export const shopOfKey = (key: string, machine: string, publicKeyPem: string): string | null => {
  try {
    const [payload, signature, ...extra] = key.replace(/\s+/g, '').split('.');
    if (!payload || !signature || extra.length) return null;
    if (!verify(null, Buffer.from(payload), createPublicKey(publicKeyPem), b64(signature))) return null;
    const data = JSON.parse(b64(payload).toString('utf8')) as { m?: unknown; n?: unknown };
    return data.m === machine && typeof data.n === 'string' ? data.n : null;
  } catch {
    return null;
  }
};

export interface LicenseFacts {
  publicKey: string;
  /** Shop name from a valid key, or null. */
  shop: string | null;
  /** True when this PC already held shop data before licensing existed: it gets a few days to activate instead of being stopped. */
  existingInstall: boolean;
  firstSeen: number;
  now: number;
}

export const decide = ({ publicKey, shop, existingInstall, firstSeen, now }: LicenseFacts): { state: LicenseState; graceDaysLeft: number | null } => {
  if (!publicKey) return { state: 'disabled', graceDaysLeft: null };
  if (shop) return { state: 'ok', graceDaysLeft: null };
  const left = Math.ceil((firstSeen + GRACE_DAYS * 86_400_000 - now) / 86_400_000);
  return existingInstall && left > 0 ? { state: 'grace', graceDaysLeft: left } : { state: 'required', graceDaysLeft: null };
};
