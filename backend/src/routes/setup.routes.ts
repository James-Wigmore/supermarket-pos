import { Router } from 'express';
import { loginLimiter } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import { needsSetup, runSetup } from '../services/setup.service';
import { setupSchema } from '../validators/setup';

export const setupRouter = Router();

setupRouter.get('/status', async (_req, res) => {
  res.json({ needsSetup: await needsSetup() });
});

setupRouter.post('/', loginLimiter, validate({ body: setupSchema }), async (req, res) => {
  await runSetup(req.body);
  res.status(201).json({ needsSetup: false });
});
