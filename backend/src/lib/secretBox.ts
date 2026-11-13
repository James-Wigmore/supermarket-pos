import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { env } from '../config/env';

/** Derived once from JWT_SECRET, so the authenticator-app secret has its own key without a separate setting to manage. */
const key = scryptSync(env.JWT_SECRET, 'pos-two-factor-secret-box', 32);

/** Encrypts a short secret (the authenticator-app key) for storage. Never used for anything a person needs back verbatim and readable. */
export const encryptSecret = (plain: string) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, encrypted, cipher.getAuthTag()].map((part) => part.toString('base64url')).join('.');
};

export const decryptSecret = (stored: string) => {
  const [ivPart, dataPart, tagPart] = stored.split('.');
  if (!ivPart || !dataPart || !tagPart) throw new Error('Invalid stored secret');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64url')), decipher.final()]).toString('utf8');
};
