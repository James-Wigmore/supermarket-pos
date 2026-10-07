import { Role, type Prisma } from '@prisma/client';
import { audit } from '../lib/audit';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { ASSIGNABLE_ROLES } from '../lib/permissions';
import { prisma } from '../lib/prisma';
import { branchFor } from '../lib/scope';
import type { Actor } from '../types';
import type { CreateUserInput, UpdateUserInput } from '../validators/auth';
import { hashPassword } from './auth.service';

export const userSelect = {
  id: true, email: true, name: true, role: true, branchId: true, isActive: true, lastLoginAt: true, createdAt: true,
  branch: { select: { name: true, code: true } },
} satisfies Prisma.UserSelect;

const assertAssignable = (actor: Actor, role: Role) => {
  if (!ASSIGNABLE_ROLES[actor.role].includes(role)) throw forbidden(`You cannot assign the ${role} role`);
};

const resolveBranch = (actor: Actor, role: Role, requested?: string | null) => {
  if (role === Role.SUPER_ADMIN) return null;
  const branchId = actor.role === Role.SUPER_ADMIN ? requested : actor.branchId;
  if (!branchId) throw badRequest('branchId is required for this role');
  return branchId;
};

export const listUsers = (actor: Actor, branchId?: string) =>
  prisma.user.findMany({
    where: { branchId: branchFor(actor, branchId) },
    select: userSelect,
    orderBy: [{ role: 'asc' }, { name: 'asc' }],
  });

export const createUser = async (actor: Actor, input: CreateUserInput) => {
  assertAssignable(actor, input.role);
  const { password, branchId, ...rest } = input;
  const user = await prisma.user.create({
    data: { ...rest, branchId: resolveBranch(actor, input.role, branchId), passwordHash: await hashPassword(password) },
    select: userSelect,
  });
  await audit(prisma, actor, { action: 'USER_CREATE', entity: 'User', entityId: user.id, after: user });
  return user;
};

export const updateUser = async (actor: Actor, id: string, input: UpdateUserInput) => {
  const before = await prisma.user.findUnique({ where: { id }, select: userSelect });
  if (!before) throw notFound('User');
  branchFor(actor, before.branchId ?? undefined);
  assertAssignable(actor, before.role);
  if (input.role) assertAssignable(actor, input.role);
  if (id === actor.id && (input.role || input.isActive === false)) throw badRequest('You cannot change your own role or deactivate yourself');

  const { password, branchId, ...rest } = input;
  const role = input.role ?? before.role;
  const securityChange = Boolean(password || input.role || input.isActive === false || branchId !== undefined);
  const user = await prisma.user.update({
    where: { id },
    data: {
      ...rest,
      ...(input.role || branchId !== undefined ? { branchId: resolveBranch(actor, role, branchId ?? before.branchId) } : {}),
      ...(password ? { passwordHash: await hashPassword(password) } : {}),
      ...(securityChange ? { tokenVersion: { increment: 1 } } : {}),
    },
    select: userSelect,
  });
  await audit(prisma, actor, {
    action: input.role && input.role !== before.role ? 'PERMISSION_CHANGE' : 'USER_UPDATE',
    entity: 'User',
    entityId: id,
    before,
    after: { ...user, passwordChanged: Boolean(password) },
  });
  return user;
};
