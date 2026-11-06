#!/usr/bin/env node
// Developer-only licence tool.
//   npm run license -- init                          one time: makes your key pair, puts the PUBLIC half in the app
//   npm run license -- issue ABCD-EFGH-IJKL-MNOP "Shop name"   makes the activation key for one PC
// The PRIVATE key stays in your home folder (never in the repo). Whoever holds it can make keys, so back it up and keep it secret.
import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const privateFile = process.env.LICENSE_KEY_FILE ?? join(homedir(), '.supermarket-pos-license', 'private.pem');
const publicFile = 'desktop/main/licenseKey.ts';
const [command, machine, ...name] = process.argv.slice(2);
const fail = (message) => { console.error(`\n${message}\n`); process.exit(1); };

if (command === 'init') {
  if (existsSync(privateFile)) fail(`A private key already exists at ${privateFile}. Keep using it: replacing it would make every key you issued stop working.`);
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  mkdirSync(dirname(privateFile), { recursive: true });
  writeFileSync(privateFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  try { chmodSync(privateFile, 0o600); } catch { /* Windows */ }
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).trim();
  writeFileSync(publicFile, `/** Public half of the licence key pair. Empty = licensing is not set up yet and every copy runs freely. Filled in by \`npm run license -- init\`. */\nexport const LICENSE_PUBLIC_KEY = \`${pem}\n\`;\n`);
  console.log(`\nDone.\n  Private key: ${privateFile}  (BACK IT UP somewhere safe and private; never share it or commit it)\n  Public key:  ${publicFile}  (commit this, then release: from then on installed apps need a key)\n`);
} else if (command === 'issue') {
  if (!/^([0-9A-F]{4}-){3}[0-9A-F]{4}$/.test(machine ?? '')) fail('Give the PC code exactly as the app shows it, e.g. 7F3A-91BC-0D42-E8A5, then the shop name in quotes.');
  if (!name.length) fail('Add the shop name in quotes after the code.');
  if (!existsSync(privateFile)) fail(`No private key at ${privateFile}. Run: npm run license -- init`);
  const payload = Buffer.from(JSON.stringify({ m: machine, n: name.join(' '), i: new Date().toISOString().slice(0, 10) })).toString('base64url');
  const signature = sign(null, Buffer.from(payload), createPrivateKey(readFileSync(privateFile))).toString('base64url');
  console.log(`\nActivation key for ${name.join(' ')} (PC ${machine}); send it to the shop:\n\n${payload}.${signature}\n`);
} else {
  fail('Usage:\n  npm run license -- init\n  npm run license -- issue <PC-CODE> "<Shop name>"');
}
