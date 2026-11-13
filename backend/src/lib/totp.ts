import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

const base32Encode = (buf: Buffer) => {
  let bits = '';
  for (const byte of buf) bits += byte.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) out += ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  const rest = bits.length % 5;
  if (rest) out += ALPHABET[parseInt(bits.slice(bits.length - rest).padEnd(5, '0'), 2)];
  return out;
};

const base32Decode = (text: string) => {
  const bits = [...text.toUpperCase().replace(/[^A-Z2-7]/g, '')].map((ch) => ALPHABET.indexOf(ch).toString(2).padStart(5, '0')).join('');
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
};

const hotp = (secret: Buffer, counter: number) => {
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', secret).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  const code = ((hmac[offset]! & 0x7f) << 24) | ((hmac[offset + 1]! & 0xff) << 16) | ((hmac[offset + 2]! & 0xff) << 8) | (hmac[offset + 3]! & 0xff);
  return String(code % 10 ** DIGITS).padStart(DIGITS, '0');
};

export const generateTotpSecret = () => base32Encode(randomBytes(20));

/** The setup link shown as a QR code (or typed in by hand) in the authenticator app. */
export const otpauthUri = (secret: string, email: string) => {
  const issuer = 'Supermarket POS';
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(email)}`;
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=${DIGITS}&period=${STEP_SECONDS}`;
};

/**
 * Accepts the current 30-second step and one either side, to allow for clock drift. `after` is the last step this
 * account has used; a step at or before it is refused so the same code (or one intercepted in transit) cannot be replayed.
 * Returns the matched step to store as the new `after`, or null when the code is wrong.
 */
export const verifyTotp = (secret: string, code: string, after: number | null, now = Date.now()): number | null => {
  const cleaned = code.replace(/\s+/g, '');
  if (!/^\d{6,8}$/.test(cleaned)) return null;
  const key = base32Decode(secret);
  const current = Math.floor(now / 1000 / STEP_SECONDS);
  for (const step of [current - 1, current, current + 1]) {
    if (after !== null && step <= after) continue;
    const expected = hotp(key, step);
    if (expected.length === cleaned.length && timingSafeEqual(Buffer.from(expected), Buffer.from(cleaned))) return step;
  }
  return null;
};

const normaliseRecoveryCode = (code: string) => code.replace(/[^A-Z0-9]/gi, '').toUpperCase();

export const generateRecoveryCode = () => randomBytes(5).toString('hex').toUpperCase().match(/.{1,4}/g)!.join('-');

/** Keyed so a stolen database alone cannot be used to forge codes; never reversible. */
export const hashRecoveryCode = (code: string) => createHmac('sha256', env.JWT_SECRET).update(normaliseRecoveryCode(code)).digest('hex');
