import { AppError } from './errors';

const limiters: { reset: () => void }[] = [];

/** Locks a key (e.g. a user) out for a while after too many attempts. In memory, per process. */
export const failureLimiter = (max: number, windowMs: number, message: string) => {
  const hits = new Map<string, { count: number; resetAt: number }>();
  const limiter = {
    assertOpen(key: string) {
      const entry = hits.get(key);
      if (entry && entry.resetAt > Date.now() && entry.count >= max) throw new AppError(429, message, 'RATE_LIMITED');
    },
    fail(key: string) {
      const now = Date.now();
      const entry = hits.get(key);
      hits.set(key, entry && entry.resetAt > now ? { ...entry, count: entry.count + 1 } : { count: 1, resetAt: now + windowMs });
    },
    /** Counts every call (not just failures): for limiting how often something may happen, e.g. sending an email. */
    consume(key: string) {
      limiter.assertOpen(key);
      limiter.fail(key);
    },
    clear: (key: string) => void hits.delete(key),
    reset: () => hits.clear(),
  };
  limiters.push(limiter);
  return limiter;
};

export const resetFailureLimiters = () => limiters.forEach((limiter) => limiter.reset());
