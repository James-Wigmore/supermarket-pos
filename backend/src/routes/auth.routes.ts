import { Router } from 'express';
import * as auth from '../services/auth.service';
import { approvalStatus, cancelApproval } from '../services/login-approval.service';
import * as users from '../services/user.service';
import { authenticate } from '../middleware/auth';
import { loginIpLimiter, loginLimiter } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import { approvalRequestSchema, changePasswordSchema, emailApprovalSchema, loginSchema, signupSchema } from '../validators/auth';

export const authRouter = Router();

authRouter.post('/login', loginIpLimiter, loginLimiter, validate({ body: loginSchema }), async (req, res) => {
  const { email, password } = req.body;
  res.json(await auth.login(email, password, { ip: req.ip, userAgent: req.headers['user-agent'] }));
});

authRouter.post('/signup', loginIpLimiter, loginLimiter, validate({ body: signupSchema }), async (req, res) => {
  const { name, email, password, branchId } = req.body;
  const created = await users.selfSignUp({ name, email, password, branchId });
  res.status(201).json(created);
});

// The browser that asked for approval holds `requestToken`. Tokens travel in the body, never in a URL.
authRouter.post('/login/approval/status', loginIpLimiter, validate({ body: approvalRequestSchema }), async (req, res) => {
  res.json(await approvalStatus(req.body.requestToken, { ip: req.ip, userAgent: req.headers['user-agent'] }));
});

authRouter.post('/login/approval/complete', loginIpLimiter, validate({ body: approvalRequestSchema }), async (req, res) => {
  res.json(await auth.completeApprovedLogin(req.body.requestToken, { ip: req.ip, userAgent: req.headers['user-agent'] }));
});

authRouter.post('/login/approval/cancel', loginIpLimiter, validate({ body: approvalRequestSchema }), async (req, res) => {
  res.json(await cancelApproval(req.body.requestToken, { ip: req.ip, userAgent: req.headers['user-agent'] }));
});

authRouter.get('/me', authenticate, async (req, res) => {
  res.json(await auth.sessionInfo(req.actor!));
});

authRouter.post('/logout', authenticate, async (req, res) => {
  await auth.logout(req.actor!);
  res.status(204).end();
});

authRouter.post('/change-password', authenticate, validate({ body: changePasswordSchema }), async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  res.json(await auth.changePassword(req.actor!, currentPassword, newPassword));
});

authRouter.post('/email-approval', authenticate, validate({ body: emailApprovalSchema }), async (req, res) => {
  await auth.setEmailApproval(req.actor!, req.body.enabled, req.body.password);
  res.status(204).end();
});
