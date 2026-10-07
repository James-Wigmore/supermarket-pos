import { rateLimit } from 'express-rate-limit';
import { isTest } from '../config/env';

const limiter = (windowMs: number, limit: number, message: string, options: Partial<Parameters<typeof rateLimit>[0]> = {}) =>
  rateLimit({
    windowMs,
    limit,
    skip: () => isTest,
    ...options,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message } },
  });

// One client (the desktop UI) makes every request, so this only guards against a runaway loop.
export const apiLimiter = limiter(60_000, 3000, 'Too many requests, slow down');

/** Failed sign-ins are counted per account, not per address: on the shop PC everyone shares one address. */
export const loginLimiter = limiter(15 * 60_000, 10, 'Too many failed sign-in attempts for this account, try again in a few minutes', {
  skipSuccessfulRequests: true,
  keyGenerator: (req) => String(req.body?.email ?? req.body?.admin?.email ?? 'anonymous').trim().toLowerCase(),
});
