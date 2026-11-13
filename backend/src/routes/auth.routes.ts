import { Router } from 'express';
import { prisma } from '../lib/prisma';
import * as auth from '../services/auth.service';
import { approvalStatus, cancelApproval } from '../services/login-approval.service';
import * as users from '../services/user.service';
import { authenticate } from '../middleware/auth';
import { loginIpLimiter, loginLimiter } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import { approvalRequestSchema, changePasswordSchema, emailApprovalSchema, loginSchema, signupSchema, twoFactorChallengeSchema, twoFactorCodeSchema, twoFactorDisableSchema } from '../validators/auth';

export const authRouter = Router();

authRouter.post('/login', loginIpLimiter, loginLimiter, validate({ body: loginSchema }), async (req, res) => {
  const { email, password } = req.body;
  res.json(await auth.login(email, password, { ip: req.ip, userAgent: req.headers['user-agent'] }));
});

// The sign-up form is shown before anyone is signed in, so it needs the branch names without a session. Names only.
authRouter.get('/branches', loginIpLimiter, async (_req, res) => {
  res.json(await prisma.branch.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }));
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

// Step 2 of signing in with an authenticator app: the challenge token proves the password was already correct.
authRouter.post('/login/totp', loginIpLimiter, loginLimiter, validate({ body: twoFactorChallengeSchema }), async (req, res) => {
  const { challengeToken, code } = req.body;
  res.json(await auth.completeTwoFactorLogin(challengeToken, code, { ip: req.ip, userAgent: req.headers['user-agent'] }));
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

authRouter.post('/totp/setup', authenticate, async (req, res) => {
  res.json(await auth.startTwoFactorSetup(req.actor!));
});

authRouter.post('/totp/confirm', authenticate, validate({ body: twoFactorCodeSchema }), async (req, res) => {
  res.json(await auth.confirmTwoFactorSetup(req.actor!, req.body.code));
});

authRouter.post('/totp/cancel', authenticate, async (req, res) => {
  await auth.cancelTwoFactorSetup(req.actor!);
  res.status(204).end();
});

authRouter.post('/totp/disable', authenticate, validate({ body: twoFactorDisableSchema }), async (req, res) => {
  await auth.disableTwoFactor(req.actor!, req.body.password);
  res.status(204).end();
});
