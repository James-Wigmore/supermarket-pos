const BASE = (import.meta.env.VITE_API_URL as string | undefined) || '/api';
const TOKEN_KEY = 'pos.token';

export class ApiError extends Error {
  constructor(public status: number, message: string, public code = 'ERROR') {
    super(message);
  }
  get isNetwork() {
    return this.status === 0;
  }
  get needsApproval() {
    return this.status === 403 && /approval/i.test(this.message);
  }
}

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

type Query = Record<string, string | number | boolean | undefined | null>;
interface Options {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Query;
  signal?: AbortSignal;
}

const withQuery = (path: string, query?: Query) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
};

/** Inside the desktop app requests go straight to the local backend; in a browser they use fetch. */
const transport = async (path: string, { method = 'GET', body, query, signal }: Options, token: string | null): Promise<Response> => {
  if (!window.pos) {
    return fetch(`${BASE}${withQuery(path, query)}`, {
      method,
      signal,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  }
  const res = await window.pos.request({ method, path: withQuery(path, query), body: body || undefined, token });
  return new Response(res.status === 204 ? null : res.body, { status: res.status, headers: { 'Content-Type': res.contentType, 'Content-Disposition': res.disposition } });
};

const send = async (path: string, options: Options) => {
  const token = tokenStore.get();
  let res: Response;
  try {
    res = await transport(path, options, token);
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'Cannot reach the server. Check the connection.', 'NETWORK');
  }
  // A site that has no API behind it (for example a hosting rewrite) answers with its own web page instead of data.
  const isPage = (res.headers.get('Content-Type') ?? '').includes('text/html');
  if (res.ok && !isPage) return res;
  if (res.ok) throw new ApiError(0, 'This site cannot reach its server. The server address is not set up (VITE_API_URL).', 'NO_API');
  const payload = (await res.json().catch(() => null)) as { error?: { message?: string; code?: string } } | null;
  if (res.status === 401 && token) window.dispatchEvent(new Event('auth:expired'));
  const fallback = isPage ? 'This site cannot reach its server. The server address is not set up (VITE_API_URL).' : res.statusText || `The server answered with error ${res.status}.`;
  throw new ApiError(res.status, payload?.error?.message || fallback, payload?.error?.code);
};

export const api = async <T>(path: string, options: Options = {}): Promise<T> => {
  const res = await send(path, options);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
};

/** Fetches a protected file (PDF/XLSX/CSV) and hands it to the browser. */
export const downloadFile = async (path: string, query: Query | undefined, filename: string | null) => {
  const blob = await (await send(path, { query })).blob();
  const href = URL.createObjectURL(blob);
  if (filename) {
    const link = Object.assign(document.createElement('a'), { href, download: filename });
    link.click();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  } else {
    window.open(href, '_blank');
  }
};
