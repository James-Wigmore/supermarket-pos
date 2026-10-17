import { protocol } from 'electron';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';

export const APP_URL = 'app://pos/';

const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob: https:",
  "font-src 'self' data:", "connect-src 'self'", "frame-src 'self' blob:", "object-src 'self' blob:", "base-uri 'none'",
].join('; ');

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/** Must run before the app is ready. A custom scheme gives the UI a stable origin for its local storage. */
export const registerAppScheme = () =>
  protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

/** Serves the built React app from `root`, falling back to index.html for client-side routes. */
export const serveApp = (root: string) =>
  protocol.handle('app', (request) => {
    const requested = normalize(join(root, decodeURIComponent(new URL(request.url).pathname)));
    const isFile = requested.startsWith(root + sep) && existsSync(requested) && statSync(requested).isFile();
    const file = isFile ? requested : join(root, 'index.html');
    const headers = new Headers({ 'Content-Type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream' });
    headers.set('Content-Security-Policy', CSP);
    return new Response(readFileSync(file), { headers });
  });
