import inject from 'light-my-request';
import type { ApiRequest, ApiResponse } from '../bridge';
import type { Backend } from '../main/backend';
import { isLicensed } from '../main/licenseStore';
import { handle } from './handle';

const METHODS = new Set<string>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

const isRequest = (value: unknown): value is ApiRequest => {
  const req = value as Partial<ApiRequest> | null;
  return (
    typeof req === 'object' && req !== null &&
    typeof req.method === 'string' && METHODS.has(req.method) &&
    typeof req.path === 'string' && /^\/[^/\\]/.test(req.path) && !req.path.includes('..') &&
    (req.token === undefined || req.token === null || typeof req.token === 'string')
  );
};

const notActivated = (): ApiResponse => ({
  status: 402,
  contentType: 'application/json',
  disposition: '',
  body: new Uint8Array(Buffer.from(JSON.stringify({ error: { code: 'NOT_ACTIVATED', message: 'This copy of Supermarket POS is not activated.' } }))),
});

/** Runs an API request against the Express app in-process: same routes, validation and permissions as before. */
export const dispatch = async (backend: Backend, req: ApiRequest): Promise<ApiResponse> => {
  const res = await inject(backend.app, {
    method: req.method,
    url: `/api${req.path}`,
    payload: req.body === undefined ? undefined : (req.body as object),
    headers: { 'user-agent': 'POS-Desktop', ...(req.token ? { authorization: `Bearer ${req.token}` } : {}) },
    remoteAddress: '127.0.0.1',
  });
  return {
    status: res.statusCode,
    contentType: String(res.headers['content-type'] ?? ''),
    disposition: String(res.headers['content-disposition'] ?? ''),
    body: new Uint8Array(res.rawPayload),
  };
};

export const registerApiIpc = (backend: Backend) =>
  handle('api:request', (_event, req: unknown) => {
    if (!isRequest(req)) throw new Error('Invalid request');
    if (!isLicensed()) return notActivated();
    return dispatch(backend, req);
  });
