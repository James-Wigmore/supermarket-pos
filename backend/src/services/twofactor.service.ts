import { randomInt } from 'node:crypto';
import type { User } from '@prisma/client';
import * as OTPAuth from 'otpauth';
import { mac, unseal } from '../lib/crypto';
import { failureLimiter } from '../lib/failureLimiter';

const PERIOD_SECONDS = 30;
const RECOVERY_CODES = 10;
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no look-alike characters

export const twoFactorLimiter = failureLimiter(5, 15 * 60_000, 'Too many incorrect codes, try again in a few minutes');

type Factors = Pick<User, 'twoFactorSecret' | 'twoFactorLastStep' | 'twoFactorRecovery'>;

const totpFor = (secret: string, label = '') =>
  new OTPAuth.TOTP({ issuer: 'Supermarket POS', label, algorithm: 'SHA1', digits: 6, period: PERIOD_SECONDS, secret: OTPAuth.Secret.fromBase32(secret) });

export const newSecret = (label: string) => {
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  return { secret, otpauthUrl: totpFor(secret, label).toString() };
};

/** The time step of a valid, not yet used code (one step either side allows for clock drift), otherwise null. */
export const matchStep = (secret: string, code: string, lastStep: number | null) => {
  const delta = totpFor(secret).validate({ token: code, window: 1 });
  if (delta === null) return null;
  const step = Math.floor(Date.now() / 1000 / PERIOD_SECONDS) + delta;
  return step > (lastStep ?? -1) ? step : null;
};

const normalise = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');

export const newRecoveryCodes = () => {
  const codes = Array.from({ length: RECOVERY_CODES }, () => {
    const raw = Array.from({ length: 10 }, () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]).join('');
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
  return { codes, stored: JSON.stringify(codes.map((code) => mac(normalise(code)))) };
};

/**
 * Checks a 6-digit authenticator code or a one-time recovery code. On success returns what to
 * save so the same code can never be used again; otherwise null.
 */
export const checkSecondFactor = (user: Factors, input: string) => {
  const code = input.replace(/\s/g, '');
  if (/^\d{6}$/.test(code)) {
    const step = user.twoFactorSecret ? matchStep(unseal(user.twoFactorSecret), code, user.twoFactorLastStep) : null;
    return step === null ? null : { method: 'totp' as const, data: { twoFactorLastStep: step } };
  }
  const hashes: string[] = user.twoFactorRecovery ? JSON.parse(user.twoFactorRecovery) : [];
  const hash = mac(normalise(code));
  return hashes.includes(hash) ? { method: 'recovery' as const, data: { twoFactorRecovery: JSON.stringify(hashes.filter((h) => h !== hash)) } } : null;
};
