import { Router } from 'express';
import { z } from 'zod';
import { can, P } from '../lib/permissions';
import { authorize } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { connectSpreadsheet, getStatus, listConflicts, recentLog, resendAll, resolveConflict, runSync } from '../sync/runtime';
import { idParams } from '../validators/common';

export const syncRouter = Router();
const admin = authorize(P.SETTINGS_MANAGE);

const connectBody = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('create'), title: z.string().trim().min(1).max(100).optional() }),
  z.object({ mode: z.literal('existing'), url: z.string().trim().min(1).max(500) }),
]);

/** Visible to every signed-in user: the cashier's sync indicator. */
syncRouter.get('/status', async (req, res) => {
  const status = await getStatus();
  res.json(can(req.actor!.role, P.SETTINGS_MANAGE) ? status : { ...status, spreadsheetUrl: null, spreadsheetTitle: null, lastError: null });
});

syncRouter.post('/run', admin, async (_req, res) => {
  res.json({ result: await runSync(), status: await getStatus() });
});

syncRouter.post('/spreadsheet', admin, validate({ body: connectBody }), async (req, res) => {
  res.json(await connectSpreadsheet(req.body));
});

syncRouter.post('/resend', admin, async (_req, res) => {
  await resendAll();
  void runSync();
  res.json(await getStatus());
});

syncRouter.get('/conflicts', admin, async (_req, res) => {
  res.json({ data: await listConflicts() });
});

syncRouter.post('/conflicts/:id/resolve', admin, validate({ params: idParams, body: z.object({ use: z.enum(['SHEET', 'LOCAL']) }) }), async (req, res) => {
  await resolveConflict(req.params.id as string, req.body.use);
  res.json(await getStatus());
});

syncRouter.get('/log', admin, async (_req, res) => {
  res.json({ data: await recentLog() });
});
