import { Router } from 'express';
import { z } from 'zod';
import { EXPORT_FORMATS, sendReport } from '../lib/export';
import { audit } from '../lib/audit';
import { pageArgs, pageQuery, pageResult } from '../lib/pagination';
import { P } from '../lib/permissions';
import { prisma } from '../lib/prisma';
import { branchFor } from '../lib/scope';
import { getSettings, saveSettings, settingsSchema } from '../lib/settings';
import { authorize } from '../middleware/auth';
import { queryOf, validate } from '../middleware/validate';
import { dashboard } from '../services/dashboard.service';
import { REPORT_NAMES, runReport, type ReportName } from '../services/report.service';
import { branchQuery, dateRange, id } from '../validators/common';

export const adminRouter = Router();

adminRouter.get('/dashboard', authorize(P.DASHBOARD_READ), validate({ query: branchQuery }), async (req, res) => {
  res.json(await dashboard(req.actor!, queryOf<{ branchId?: string }>(req).branchId));
});

const reportParams = z.object({ name: z.enum(REPORT_NAMES) });
const reportQuery = dateRange.extend({
  branchId: id.optional(),
  groupBy: z.string().optional(),
  window: z.string().optional(),
  format: z.enum(EXPORT_FORMATS).default('json'),
});

adminRouter.get('/reports/:name', authorize(P.REPORT_READ), validate({ params: reportParams, query: reportQuery }), async (req, res) => {
  const { format, ...params } = queryOf<z.infer<typeof reportQuery>>(req);
  const name = req.params.name as ReportName;
  const report = await runReport(req.actor!, name, params);
  await sendReport(res, format, report, `${name}-${new Date().toISOString().slice(0, 10)}`);
});

const auditQuery = pageQuery.extend(dateRange.shape).extend({
  action: z.string().trim().optional(),
  entity: z.string().trim().optional(),
  userId: id.optional(),
  branchId: id.optional(),
});

adminRouter.get('/audit-logs', authorize(P.AUDIT_READ), validate({ query: auditQuery }), async (req, res) => {
  const q = queryOf<z.infer<typeof auditQuery>>(req);
  const where = {
    branchId: branchFor(req.actor!, q.branchId), action: q.action, entity: q.entity, userId: q.userId, createdAt: { gte: q.from, lte: q.to },
  };
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(q) }),
    prisma.auditLog.count({ where }),
  ]);
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => (r.userId ? [r.userId] : [])))] } }, select: { id: true, name: true } });
  const names = new Map(users.map((u) => [u.id, u.name]));
  res.json(pageResult(rows.map((r) => ({ ...r, userName: r.userId ? names.get(r.userId) ?? null : null })), total, q));
});

adminRouter.get('/settings', async (_req, res) => {
  res.json(await getSettings());
});

adminRouter.put('/settings', authorize(P.SETTINGS_MANAGE), validate({ body: settingsSchema }), async (req, res) => {
  const before = await getSettings();
  await saveSettings(req.body);
  await audit(prisma, req.actor!, { action: 'SETTINGS_UPDATE', entity: 'Setting', entityId: 'app', before, after: req.body });
  res.json(req.body);
});
