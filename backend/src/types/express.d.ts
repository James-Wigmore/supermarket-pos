import type { Actor } from './index';

declare global {
  namespace Express {
    interface Request {
      actor?: Actor;
    }
  }
}

export {};
