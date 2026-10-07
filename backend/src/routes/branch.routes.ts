import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../lib/audit';
import { crudRouter } from '../lib/crud';
import { P } from '../lib/permissions';
import { prisma } from '../lib/prisma';
import { Role } from '@prisma/client';
import { authorize } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { idParams } from '../validators/common';

const branchFields = {
  name: z.string().trim().min(1).max(100),
  address: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(30).optional(),
};
const createBranch = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,10}$/), ...branchFields });
const updateBranch = z.object({ ...branchFields, isActive: z.boolean() }).partial();

export const branchRouter = Router();

branchRouter.get('/', async (req, res) => {
  const { role, branchId } = req.actor!;
  res.json(await prisma.branch.findMany({ where: role === Role.SUPER_ADMIN ? {} : { id: branchId! }, orderBy: { name: 'asc' } }));
});

branchRouter.post('/', authorize(P.BRANCH_MANAGE), validate({ body: createBranch }), async (req, res) => {
  const branch = await prisma.branch.create({ data: req.body });
  await audit(prisma, req.actor!, { action: 'BRANCH_CREATE', entity: 'Branch', entityId: branch.id, after: branch });
  res.status(201).json(branch);
});

branchRouter.patch('/:id', authorize(P.BRANCH_MANAGE), validate({ params: idParams, body: updateBranch }), async (req, res) => {
  const before = await prisma.branch.findUniqueOrThrow({ where: { id: req.params.id as string } });
  const branch = await prisma.branch.update({ where: { id: before.id }, data: req.body });
  await audit(prisma, req.actor!, { action: 'BRANCH_UPDATE', entity: 'Branch', entityId: branch.id, before, after: branch });
  res.json(branch);
});

export const registerRouter = crudRouter({
  entity: 'Register',
  delegate: prisma.register,
  read: P.SESSION_OWN,
  write: P.USER_MANAGE,
  createSchema: z.object({ name: z.string().trim().min(1).max(50), branchId: z.uuid().optional() }),
  updateSchema: z.object({ name: z.string().trim().min(1).max(50), isActive: z.boolean() }).partial(),
  search: ['name'],
  orderBy: { name: 'asc' },
  branchScoped: true,
});
