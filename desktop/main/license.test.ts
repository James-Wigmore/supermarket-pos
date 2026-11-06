import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decide, GRACE_DAYS, machineCodeFrom, shopOfKey } from './license';

const pair = () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { pem: publicKey.export({ type: 'spki', format: 'pem' }).toString(), priv: privateKey };
};
const issue = (priv: ReturnType<typeof pair>['priv'], m: string, n = 'Shop') => {
  const payload = Buffer.from(JSON.stringify({ m, n })).toString('base64url');
  return `${payload}.${sign(null, Buffer.from(payload), priv).toString('base64url')}`;
};

describe('PC code', () => {
  it('is the same for the same PC and different for another', () => {
    expect(machineCodeFrom('guid-1')).toBe(machineCodeFrom(' GUID-1 '));
    expect(machineCodeFrom('guid-1')).not.toBe(machineCodeFrom('guid-2'));
    expect(machineCodeFrom('guid-1')).toMatch(/^([0-9A-F]{4}-){3}[0-9A-F]{4}$/);
  });
});

describe('activation key', () => {
  const { pem, priv } = pair();
  const pc = machineCodeFrom('pc-a');

  it('opens the PC it was made for, even if the shop pasted it with line breaks', () => {
    const key = issue(priv, pc, 'Mama Sarah Stores');
    expect(shopOfKey(key, pc, pem)).toBe('Mama Sarah Stores');
    expect(shopOfKey(`${key.slice(0, 40)}\n${key.slice(40)}`, pc, pem)).toBe('Mama Sarah Stores');
  });

  it('does not open another PC: a copied installer and key are useless elsewhere', () => {
    expect(shopOfKey(issue(priv, pc), machineCodeFrom('pc-b'), pem)).toBeNull();
  });

  it('rejects a changed name, a key signed by someone else, and rubbish', () => {
    const key = issue(priv, pc);
    const [payload = '', signature = ''] = key.split('.');
    const forged = Buffer.from(JSON.stringify({ m: pc, n: 'Someone else' })).toString('base64url');
    expect(shopOfKey(`${forged}.${signature}`, pc, pem)).toBeNull();
    expect(shopOfKey(issue(pair().priv, pc), pc, pem)).toBeNull();
    for (const bad of ['', 'abc', `${payload}.`, `${key}.x`]) expect(shopOfKey(bad, pc, pem)).toBeNull();
  });
});

describe('what the app does', () => {
  const day = 86_400_000;
  const base = { publicKey: 'pem', shop: null, existingInstall: false, firstSeen: 0, now: 0 };

  it('lets everything run until licensing is set up', () => {
    expect(decide({ ...base, publicKey: '' }).state).toBe('disabled');
  });
  it('stops a new copy at once, and allows an activated one', () => {
    expect(decide(base).state).toBe('required');
    expect(decide({ ...base, shop: 'Shop' }).state).toBe('ok');
  });
  it('gives an existing shop a few days, counting down, then stops it', () => {
    expect(decide({ ...base, existingInstall: true, now: 3 * day })).toEqual({ state: 'grace', graceDaysLeft: GRACE_DAYS - 3 });
    expect(decide({ ...base, existingInstall: true, now: GRACE_DAYS * day }).state).toBe('required');
  });
});
