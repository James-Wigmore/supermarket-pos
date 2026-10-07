import { app, dialog, net, safeStorage, shell, type BrowserWindow } from 'electron';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import type { GoogleStatus } from '../bridge';

/** Credentials of the owner's own Google Cloud project, and the sign-in token. Always encrypted with Windows' own protection. */
interface Stored {
  clientId: string;
  clientSecret: string;
  refreshToken?: string;
}

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;
const EXPIRY_MARGIN_MS = 60_000;

const file = () => join(app.getPath('userData'), 'google.bin');
let stored: Stored | null | undefined;
let cached: { token: string; expiresAt: number } | null = null;

const load = (): Stored | null => {
  if (stored !== undefined) return stored;
  try {
    stored = JSON.parse(safeStorage.decryptString(readFileSync(file()))) as Stored;
  } catch {
    stored = null;
  }
  return stored;
};

const save = (next: Stored | null) => {
  if (next && !safeStorage.isEncryptionAvailable()) throw new Error('Windows secure storage is not available, so Google sign-in cannot be saved safely on this computer.');
  stored = next;
  cached = null;
  if (next) writeFileSync(file(), safeStorage.encryptString(JSON.stringify(next)));
  else rmSync(file(), { force: true });
};

export const googleStatus = (): GoogleStatus => ({
  hasCredentials: Boolean(load()?.clientId),
  connected: Boolean(load()?.refreshToken),
  canStore: safeStorage.isEncryptionAvailable(),
});

/** Reads the `client_secret_….json` file downloaded from Google Cloud ("Desktop app" client). */
export const importCredentials = async (parent: BrowserWindow) => {
  const picked = await dialog.showOpenDialog(parent, { title: 'Choose the Google credentials file (JSON)', filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] });
  const source = picked.filePaths[0];
  if (picked.canceled || !source) return null;
  const parsed = JSON.parse(readFileSync(source, 'utf8')) as { installed?: { client_id?: string; client_secret?: string } };
  const { client_id: clientId, client_secret: clientSecret } = parsed.installed ?? {};
  if (!clientId || !clientSecret) throw new Error('That file is not a Google "Desktop app" credentials file. Create an OAuth client of type "Desktop app" and download its JSON.');
  save({ clientId, clientSecret });
  return googleStatus();
};

const tokenRequest = async (params: Record<string, string>) => {
  const res = await net.fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
  const body = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
  return { ok: res.ok, body };
};

const PAGE = (message: string) => `<!doctype html><meta charset="utf-8"><title>Supermarket POS</title><body style="font-family:sans-serif;text-align:center;margin-top:20vh"><h2>${message}</h2><p>You can close this window and return to Supermarket POS.</p>`;

/** Waits for Google to redirect the browser back to a one-time local address and returns the authorisation code. */
const waitForCode = (state: string, onListening: (redirectUri: string) => void) =>
  new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
    const server = createServer((req, res) => {
      const query = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams;
      const code = query.get('code');
      if (!code && !query.get('error')) {
        res.writeHead(404).end();
        return;
      }
      const ok = Boolean(code) && query.get('state') === state;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(PAGE(ok ? 'Google connected' : 'Google sign-in was cancelled'));
      clearTimeout(timer);
      server.close();
      if (ok) resolve({ code: code!, redirectUri });
      else reject(new Error('Google sign-in was cancelled.'));
    });
    const timer = setTimeout(() => {
      server.close();
      reject(new Error('Google sign-in timed out. Please try again.'));
    }, SIGN_IN_TIMEOUT_MS);
    let redirectUri = '';
    server.listen(0, '127.0.0.1', () => {
      redirectUri = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      onListening(redirectUri);
    });
  });

/** Opens Google's sign-in page in the default browser and stores the resulting refresh token. */
export const connectGoogle = async () => {
  const credentials = load();
  if (!credentials) throw new Error('Import the Google credentials file first.');
  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(16).toString('hex');

  const { code, redirectUri } = await waitForCode(state, (redirectUri) => {
    const url = new URL(AUTH_URL);
    url.search = new URLSearchParams({
      client_id: credentials.clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPE, state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
      access_type: 'offline', prompt: 'consent',
    }).toString();
    void shell.openExternal(url.toString());
  });

  const { ok, body } = await tokenRequest({
    code, client_id: credentials.clientId, client_secret: credentials.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier,
  });
  if (!ok || !body.refresh_token) throw new Error(body.error_description ?? 'Google did not complete the sign-in. Please try again.');
  save({ ...credentials, refreshToken: body.refresh_token });
  return googleStatus();
};

/** A valid access token, or null when Google is not connected (or access was withdrawn). Throws when offline. */
export const accessToken = async (): Promise<string | null> => {
  const credentials = load();
  if (!credentials?.refreshToken) return null;
  if (cached && cached.expiresAt - EXPIRY_MARGIN_MS > Date.now()) return cached.token;
  const { ok, body } = await tokenRequest({
    client_id: credentials.clientId, client_secret: credentials.clientSecret, refresh_token: credentials.refreshToken, grant_type: 'refresh_token',
  });
  if (!ok) {
    if (body.error === 'invalid_grant') save({ clientId: credentials.clientId, clientSecret: credentials.clientSecret });
    return null;
  }
  cached = { token: body.access_token!, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return cached.token;
};

export const disconnectGoogle = async () => {
  const credentials = load();
  if (credentials?.refreshToken) {
    await net.fetch(`${REVOKE_URL}?token=${encodeURIComponent(credentials.refreshToken)}`, { method: 'POST' }).catch(() => undefined);
    save({ clientId: credentials.clientId, clientSecret: credentials.clientSecret });
  }
  return googleStatus();
};
