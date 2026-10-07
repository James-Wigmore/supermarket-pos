import { Router } from 'express';
import { z, type ZodType } from 'zod';
import { audit } from './audit';
import { notFound } from './errors';
import { pageArgs, pageQuery, pageResult } from './pagination';
import { prisma } from './prisma';
import type { Permission } from './permissions';
import { branchFor, requireBranch } from './scope';
import { authorize } from '../middleware/auth';
import { queryOf, validate } from '../middleware/validate';
import { idParams } from '../validators/common';
import type { Actor } from '../types';

interface Delegate {
  findMany(args: object): Promise<unknown[]>;
  count(args: object): Promise<number>;
  findUnique(args: object): Promise<unknown>;
  create(args: object): Promise<unknown>;
  update(args: object): Promise<unknown>;
  delete(args: object): Promise<unknown>;
}

interface CrudConfig {
  entity: string;
  delegate: Delegate;
  read: Permission;
  write: Permission;
  createSchema: ZodType;
  updateSchema: ZodType;
  search?: string[];
  orderBy?: object;
  include?: object;
  branchScoped?: boolean;
  dateField?: string;
  stamp?: (actor: Actor) => object;
  deletable?: boolean;
}

const listQuery = pageQuery.extend({
  search: z.string().trim().optional(),
  branchId: z.uuid().optional(),
  isActive: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
type ListQuery = z.infer<typeof listQuery>;

const buildWhere = (config: CrudConfig, actor: Actor, q: ListQuery) => {
  const where: Record<string, unknown> = {};
  if (q.search && config.search) {
    where.OR = config.search.map((field) => ({ [field]: { contains: q.search } }));
  }
  if (q.isActive !== undefined) where.isActive = q.isActive;
  if (config.branchScoped) {
    const branchId = branchFor(actor, q.branchId);
    if (branchId) where.branchId = branchId;
  }
  if (config.dateField && (q.from || q.to)) {
    where[config.dateField] = { gte: q.from, lte: q.to };
  }
  return where;
};

const findOr404 = async (config: CrudConfig, actor: Actor, id: string) => {
  const record = (await config.delegate.findUnique({ where: { id }, include: config.include })) as
    | (Record<string, unknown> & { branchId?: string })
    | null;
  if (!record) throw notFound(config.entity);
  if (config.branchScoped) branchFor(actor, record.branchId);
  return record;
};

/** Standard permission-guarded, audited CRUD routes for simple resources. */
export const crudRouter = (config: CrudConfig) => {
  const router = Router();
  const { entity, delegate } = config;

  router.get('/', authorize(config.read), validate({ query: listQuery }), async (req, res) => {
    const q = queryOf<ListQuery>(req);
    const where = buildWhere(config, req.actor!, q);
    const [rows, total] = await Promise.all([
      delegate.findMany({ where, orderBy: config.orderBy, include: config.include, ...pageArgs(q) }),
      delegate.count({ where }),
    ]);
    res.json(pageResult(rows, total, q));
  });

  router.get('/:id', authorize(config.read), validate({ params: idParams }), async (req, res) => {
    res.json(await findOr404(config, req.actor!, req.params.id as string));
  });

  router.post('/', authorize(config.write), validate({ body: config.createSchema }), async (req, res) => {
    const actor = req.actor!;
    const data = { ...req.body, ...config.stamp?.(actor) };
    if (config.branchScoped) data.branchId = requireBranch(actor, req.body.branchId);
    const created = (await delegate.create({ data })) as { id: string };
    await audit(prisma, actor, { action: `${entity.toUpperCase()}_CREATE`, entity, entityId: created.id, after: created });
    res.status(201).json(created);
  });

  router.patch('/:id', authorize(config.write), validate({ params: idParams, body: config.updateSchema }), async (req, res) => {
    const actor = req.actor!;
    const before = await findOr404(config, actor, req.params.id as string);
    const updated = await delegate.update({ where: { id: before.id }, data: req.body });
    await audit(prisma, actor, { action: `${entity.toUpperCase()}_UPDATE`, entity, entityId: before.id as string, before, after: updated });
    res.json(updated);
  });

  if (config.deletable) {
    router.delete('/:id', authorize(config.write), validate({ params: idParams }), async (req, res) => {
      const before = await findOr404(config, req.actor!, req.params.id as string);
      await delegate.delete({ where: { id: before.id } });
      await audit(prisma, req.actor!, { action: `${entity.toUpperCase()}_DELETE`, entity, entityId: before.id as string, before });
      res.status(204).end();
    });
  }
  return router;
};
