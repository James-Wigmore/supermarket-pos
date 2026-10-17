import express, { Router, type RequestHandler } from 'express';
import { AppError } from '../lib/errors';
import { approvalLinkLimiter } from '../middleware/rateLimit';
import { decideLink, inspectLink, type LinkAction } from '../services/login-approval.service';
import { confirmPage, resultPage } from '../services/login-approval.pages';

/** The pages opened from the approval email. Hosted by the backend itself, so approving needs no access to the till's PC. */
export const approvalPageRouter = Router();

const noStore: RequestHandler = (_req, res, next) => {
  res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' });
  next();
};

const approvalLimiterAndBody: RequestHandler[] = [approvalLinkLimiter, express.urlencoded({ extended: false, limit: '4kb' })];

const asString = (value: unknown) => (typeof value === 'string' ? value.slice(0, 200) : '');

const route = (action: LinkAction) => {
  const failure = (res: express.Response, err: unknown) => {
    if (!(err instanceof AppError)) throw err;
    res.status(err.status).type('html').send(resultPage(false, 'Link cannot be used', err.message));
  };
  const ctx = (req: express.Request) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

  approvalPageRouter.get(`/${action}`, noStore, approvalLinkLimiter, async (req, res) => {
    const token = asString(req.query.token);
    try {
      res.type('html').send(confirmPage(action, token, await inspectLink(action, token, ctx(req))));
    } catch (err) {
      failure(res, err);
    }
  });

  approvalPageRouter.post(`/${action}`, noStore, ...approvalLimiterAndBody, async (req, res) => {
    try {
      await decideLink(action, asString(req.body?.token), ctx(req));
      res.type('html').send(action === 'approve'
        ? resultPage(true, 'Login approved', 'You can close this page. The sign-in will finish on the device that asked for it.')
        : resultPage(true, 'Login rejected', 'The sign-in was stopped. If it was not you, ask your manager to reset your password.'));
    } catch (err) {
      failure(res, err);
    }
  });
};

route('approve');
route('reject');
