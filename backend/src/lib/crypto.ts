import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { env } from '../config/env';

const derive = (purpose: string) => Buffer.from(hkdfSync('sha256', env.JWT_SECRET, 'pos-v1', purpose, 32));
const sealKey = derive('two-factor-secret');
const macKey = derive('two-factor-recovery');

/** Encrypts a secret for storage (AES-256-GCM). */
export const seal = (plain: string) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', sealKey, iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((part) => part.toString('base64url')).join('.');
};

/** Throws when the value is damaged or was sealed with a different key. */
export const unseal = (sealed: string) => {
  const [iv, tag, body] = sealed.split('.').map((part) => Buffer.from(part, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', sealKey, iv!);
  decipher.setAuthTag(tag!);
  return Buffer.concat([decipher.update(body!), decipher.final()]).toString('utf8');
};

/** Keyed hash for recovery codes: a stolen database alone cannot be brute-forced offline. */
export const mac = (value: string) => createHmac('sha256', macKey).update(value).digest('hex');
