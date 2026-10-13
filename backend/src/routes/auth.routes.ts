import { Router } from 'express';
import * as auth from '../services/auth.service';
import { authenticate, authenticateOrSetup } from '../middleware/auth';
import { loginLimiter } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import { changePasswordSchema, confirmSetupSchema, disableTwoFactorSchema, loginSchema, setupSchema, verifyLoginSchema } from '../validators/auth';

export const authRouter = Router();

authRouter.post('/login', loginLimiter, validate({ body: loginSchema }), async (req, res) => {
  const { email, password } = req.body;
  res.json(await auth.login(email, password, { ip: req.ip, userAgent: req.headers['user-agent'] }));
});

authRouter.post('/login/verify', loginLimiter, validate({ body: verifyLoginSchema }), async (req, res) => {
  res.json(await auth.verifyLogin(req.body.challengeToken, req.body.code, { ip: req.ip, userAgent: req.headers['user-agent'] }));
});

authRouter.get('/me', authenticate, async (req, res) => {
  res.json(await auth.sessionInfo(req.actor!));
});

authRouter.post('/logout', authenticate, async (req, res) => {
  await auth.logout(req.actor!);
  res.status(204).end();
});

authRouter.post('/change-password', authenticate, validate({ body: changePasswordSchema }), async (req, res) => {
  const { currentPassword, newPassword, code } = req.body;
  res.json(await auth.changePassword(req.actor!, currentPassword, newPassword, code));
});

// Two-factor enrolment: for a signed-in user, or (setupToken in the body) for someone whose role requires it at login.
authRouter.post('/2fa/setup', authenticateOrSetup, validate({ body: setupSchema }), async (req, res) => {
  res.json(await auth.startTwoFactorSetup(req.actor!));
});

authRouter.post('/2fa/confirm', authenticateOrSetup, validate({ body: confirmSetupSchema }), async (req, res) => {
  res.json(await auth.confirmTwoFactorSetup(req.actor!, req.body.code, { ip: req.ip, userAgent: req.headers['user-agent'] }, Boolean(req.setupFlow)));
});

authRouter.post('/2fa/disable', authenticate, validate({ body: disableTwoFactorSchema }), async (req, res) => {
  await auth.disableTwoFactor(req.actor!, req.body.password, req.body.code);
  res.status(204).end();
});
