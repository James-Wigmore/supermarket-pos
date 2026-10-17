import { Role, type Prisma } from '@prisma/client';
import { audit } from '../lib/audit';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { ASSIGNABLE_ROLES, outranks } from '../lib/permissions';
import { prisma } from '../lib/prisma';
import { branchFor } from '../lib/scope';
import type { Actor } from '../types';
import type { CreateUserInput, UpdateUserInput } from '../validators/auth';
import { hashPassword } from './auth.service';
import { cancelOpenApprovals } from './login-approval.service';

export const userSelect = {
  id: true, email: true, name: true, role: true, branchId: true, isActive: true, lastLoginAt: true, createdAt: true, emailApprovalEnabled: true,
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

  const { branchId, ...rest } = input;
  const role = input.role ?? before.role;
  const securityChange = Boolean(input.role || input.isActive === false || branchId !== undefined);
  const user = await prisma.user.update({
    where: { id },
    data: {
      ...rest,
      ...(input.role || branchId !== undefined ? { branchId: resolveBranch(actor, role, branchId ?? before.branchId) } : {}),
      ...(securityChange ? { tokenVersion: { increment: 1 } } : {}),
    },
    select: userSelect,
  });
  if (securityChange) await cancelOpenApprovals(id, 'account changed by an administrator', actor);
  await audit(prisma, actor, {
    action: input.role && input.role !== before.role ? 'PERMISSION_CHANGE' : 'USER_UPDATE',
    entity: 'User',
    entityId: id,
    before,
    after: user,
  });
  return user;
};

/** The user must rank below the actor and, for managers, work in the same branch. */
const loadManaged = async (actor: Actor, id: string) => {
  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true, branchId: true } });
  if (!target) throw notFound('User');
  if (!outranks(actor.role, target.role)) throw forbidden('You can only manage users ranked below you');
  branchFor(actor, target.branchId ?? undefined);
  return target;
};

/** Managers set new passwords for staff below them (super admins for anyone below). The user is signed out everywhere. */
export const resetPassword = async (actor: Actor, id: string, password: string) => {
  const target = await loadManaged(actor, id);
  await prisma.user.update({ where: { id }, data: { passwordHash: await hashPassword(password), tokenVersion: { increment: 1 } } });
  await cancelOpenApprovals(id, 'password reset', actor);
  await audit(prisma, actor, { action: 'PASSWORD_RESET', entity: 'User', entityId: id, branchId: target.branchId });
};

/**
 * Corrects a user's email, which is also their sign-in name and where approval links go. Only someone ranked above them can do it
 * (so nobody can redirect their own approvals), and it signs them out and cancels pending approvals.
 */
export const changeEmail = async (actor: Actor, id: string, email: string) => {
  if (id === actor.id) throw forbidden('You cannot change your own email. Ask someone ranked above you.');
  const target = await loadManaged(actor, id);
  const before = await prisma.user.findUniqueOrThrow({ where: { id }, select: { email: true } });
  if (before.email === email) return;
  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) throw conflict('Another account already uses that email');
  await prisma.user.update({ where: { id }, data: { email, tokenVersion: { increment: 1 } } });
  await cancelOpenApprovals(id, 'email address changed', actor);
  await audit(prisma, actor, { action: 'USER_EMAIL_CHANGE', entity: 'User', entityId: id, branchId: target.branchId, before: { email: before.email }, after: { email } });
};
