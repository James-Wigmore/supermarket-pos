import { net, protocol } from 'electron';
import { existsSync, statSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export const APP_URL = 'app://pos/';

const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob: https:",
  "font-src 'self' data:", "connect-src 'self'", "frame-src 'self' blob:", "object-src 'self' blob:", "base-uri 'none'",
].join('; ');

/** Must run before the app is ready. A custom scheme gives the UI a stable origin for its local storage. */
export const registerAppScheme = () =>
  protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

/** Serves the built React app from `root`, falling back to index.html for client-side routes. */
export const serveApp = (root: string) =>
  protocol.handle('app', async (request) => {
    const requested = normalize(join(root, decodeURIComponent(new URL(request.url).pathname)));
    const isFile = requested.startsWith(root + sep) && existsSync(requested) && statSync(requested).isFile();
    const res = await net.fetch(pathToFileURL(isFile ? requested : join(root, 'index.html')).toString());
    const headers = new Headers(res.headers);
    headers.set('Content-Security-Policy', CSP);
    return new Response(res.body, { status: res.status, headers });
  });
