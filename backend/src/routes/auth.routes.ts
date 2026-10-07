import { Router } from 'express';
import * as auth from '../services/auth.service';
import { authenticate } from '../middleware/auth';
import { loginLimiter } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import { changePasswordSchema, loginSchema } from '../validators/auth';

export const authRouter = Router();

authRouter.post('/login', loginLimiter, validate({ body: loginSchema }), async (req, res) => {
  const { email, password } = req.body;
  res.json(await auth.login(email, password, { ip: req.ip, userAgent: req.headers['user-agent'] }));
});

authRouter.get('/me', authenticate, async (req, res) => {
  res.json(await auth.sessionInfo(req.actor!));
});

authRouter.post('/logout', authenticate, async (req, res) => {
  await auth.logout(req.actor!);
  res.status(204).end();
});

authRouter.post('/change-password', authenticate, validate({ body: changePasswordSchema }), async (req, res) => {
  res.json(await auth.changePassword(req.actor!, req.body.currentPassword, req.body.newPassword));
});
