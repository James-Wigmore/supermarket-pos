import { createHmac } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PASSWORD, app, auth, createWorld } from './helpers';

type World = Awaited<ReturnType<typeof createWorld>>;
let w: World;
beforeEach(async () => { w = await createWorld(); });
afterEach(() => vi.useRealTimers());

/** Moves the fake clock forward by whole 30-second steps, so the next generated code is a fresh, unused one. */
const tick = (steps = 1) => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(Date.now() + steps * 30_000 + 1000)); };

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const base32Decode = (text: string) => {
  const bits = [...text.toUpperCase().replace(/[^A-Z2-7]/g, '')].map((ch) => ALPHABET.indexOf(ch).toString(2).padStart(5, '0')).join('');
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
};
/** Computes the current 6-digit code for a secret, mirroring the app's own TOTP implementation (src/lib/totp.ts). */
const codeFor = (secret: string) => {
  const counter = Math.floor(Date.now() / 1000 / 30);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', base32Decode(secret)).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  const code = ((hmac[offset]! & 0x7f) << 24) | ((hmac[offset + 1]! & 0xff) << 16) | ((hmac[offset + 2]! & 0xff) << 8) | (hmac[offset + 3]! & 0xff);
  return String(code % 10 ** 6).padStart(6, '0');
};

const setup = (token: string) => request(app).post('/api/auth/totp/setup').set(auth(token)).send();
const confirm = (token: string, code: string) => request(app).post('/api/auth/totp/confirm').set(auth(token)).send({ code });
const loginPassword = (email: string) => request(app).post('/api/auth/login').send({ email, password: PASSWORD });
const loginCode = (challengeToken: string, code: string) => request(app).post('/api/auth/login/totp').send({ challengeToken, code });

/** Sets up and confirms an authenticator app for the given user, returning its secret and recovery codes. */
const enableTwoFactor = async (token: string) => {
  const started = await setup(token);
  const confirmed = await confirm(token, codeFor(started.body.secret as string));
  return { secret: started.body.secret as string, recoveryCodes: confirmed.body.recoveryCodes as string[] };
};

describe('authenticator-app two-factor', () => {
  it('sets up, confirms with a real code, and hands back one-time recovery codes', async () => {
    const { recoveryCodes } = await enableTwoFactor(w.users.MANAGER.token);
    expect(recoveryCodes).toHaveLength(8);
  });

  it('refuses a wrong confirmation code', async () => {
    const { token } = w.users.MANAGER;
    await setup(token);
    expect((await confirm(token, '000000')).status).toBe(400);
  });

  it('refuses to start a second setup while one is already on', async () => {
    const { token } = w.users.MANAGER;
    await enableTwoFactor(token);
    expect((await setup(token)).status).toBe(400);
  });

  it('asks for a code at login once it is on, and signs in with a correct one', async () => {
    const { token, email } = w.users.MANAGER;
    const { secret } = await enableTwoFactor(token);

    const attempt = await loginPassword(email);
    expect(attempt.body).toMatchObject({ nextStep: 'totp' });
    expect(attempt.body.token).toBeUndefined();

    tick();
    const signedIn = await loginCode(attempt.body.challengeToken, codeFor(secret));
    expect(signedIn.status).toBe(200);
    expect(signedIn.body.token).toBeTruthy();
    expect(signedIn.body.twoFactor).toMatchObject({ enabled: true });
  });

  it('refuses a wrong code, and the same code cannot be reused on the next attempt', async () => {
    const { token, email } = w.users.MANAGER;
    const { secret } = await enableTwoFactor(token);
    tick();
    const attempt = await loginPassword(email);
    expect((await loginCode(attempt.body.challengeToken, '000000')).status).toBe(400);

    const code = codeFor(secret);
    expect((await loginCode(attempt.body.challengeToken, code)).status).toBe(200);

    const attempt2 = await loginPassword(email);
    expect((await loginCode(attempt2.body.challengeToken, code)).status).toBe(400);
  });

  it('signs in with a recovery code, which then cannot be used again', async () => {
    const { token, email } = w.users.MANAGER;
    const { recoveryCodes } = await enableTwoFactor(token);
    const recoveryCode: string = recoveryCodes[0] ?? '';

    tick();
    const attempt = await loginPassword(email);
    expect((await loginCode(attempt.body.challengeToken, recoveryCode)).status).toBe(200);

    const attempt2 = await loginPassword(email);
    expect((await loginCode(attempt2.body.challengeToken, recoveryCode)).status).toBe(400);
  });

  it('can be cancelled before it is confirmed, leaving sign-in on password only', async () => {
    const { token, email } = w.users.MANAGER;
    await setup(token);
    expect((await request(app).post('/api/auth/totp/cancel').set(auth(token)).send()).status).toBe(204);
    expect((await loginPassword(email)).body.token).toBeTruthy();
  });

  it('cannot be turned off without the right password', async () => {
    const { token } = w.users.MANAGER;
    await enableTwoFactor(token);
    expect((await request(app).post('/api/auth/totp/disable').set(auth(token)).send({ password: 'wrong-password' })).status).toBe(400);
  });

  it('turns off with the right password, and login goes back to password only', async () => {
    const { token, email } = w.users.MANAGER;
    await enableTwoFactor(token);
    expect((await request(app).post('/api/auth/totp/disable').set(auth(token)).send({ password: PASSWORD })).status).toBe(204);
    expect((await loginPassword(email)).body.token).toBeTruthy();
  });
});
