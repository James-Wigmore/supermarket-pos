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

/** Every sign-in or approval-status request, per address. Generous, because a shop's tills may share one address. */
export const loginIpLimiter = limiter(15 * 60_000, 150, 'Too many sign-in requests from this device, try again in a few minutes');

/** Opening or confirming an approval link: a real person needs two or three requests. */
export const approvalLinkLimiter = limiter(15 * 60_000, 60, 'Too many attempts, try again in a few minutes');

/** Failed sign-ins are counted per account, not per address: on the shop PC everyone shares one address. */
export const loginLimiter = limiter(15 * 60_000, 10, 'Too many failed sign-in attempts for this account, try again in a few minutes', {
  skipSuccessfulRequests: true,
  keyGenerator: (req) => String(req.body?.email ?? req.body?.admin?.email ?? 'anonymous').trim().toLowerCase(),
});
