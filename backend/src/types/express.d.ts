import type { Actor } from './index';

declare global {
  namespace Express {
    interface Request {
      actor?: Actor;
      /** True when the request was authorised by a login's enrolment token rather than a session. */
      setupFlow?: boolean;
    }
  }
}

export {};
