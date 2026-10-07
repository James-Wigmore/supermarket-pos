import bcrypt from 'bcryptjs';
import { env } from '../config/env';
import { audit } from '../lib/audit';
import { badRequest, unauthorized } from '../lib/errors';
import { ROLE_PERMISSIONS } from '../lib/permissions';
import { prisma } from '../lib/prisma';
import { signToken } from '../middleware/auth';
import type { Actor } from '../types';

// Compared against when the user does not exist, so timing does not reveal valid emails.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', env.BCRYPT_ROUNDS);

export const hashPassword = (password: string) => bcrypt.hash(password, env.BCRYPT_ROUNDS);

export const sessionInfo = async (actor: Actor) => {
  const branch = actor.branchId
    ? await prisma.branch.findUnique({ where: { id: actor.branchId }, select: { id: true, name: true, code: true } })
    : null;
  return {
    user: { id: actor.id, name: actor.name, email: actor.email, role: actor.role, branchId: actor.branchId },
    branch,
    permissions: ROLE_PERMISSIONS[actor.role],
  };
};

export const login = async (email: string, password: string, ctx: Pick<Actor, 'ip' | 'userAgent'>) => {
  const user = await prisma.user.findUnique({ where: { email } });
  const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !valid || !user.isActive) {
    await audit(prisma, null, { action: 'LOGIN_FAILED', entity: 'User', entityId: user?.id, after: { email, ...ctx } });
    throw unauthorized('Invalid email or password');
  }
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const actor: Actor = { id: user.id, name: user.name, email, role: user.role, branchId: user.branchId, ...ctx };
  await audit(prisma, actor, { action: 'LOGIN', entity: 'User', entityId: user.id });
  return { token: signToken(user), ...(await sessionInfo(actor)) };
};

export const logout = (actor: Actor) => audit(prisma, actor, { action: 'LOGOUT', entity: 'User', entityId: actor.id });

export const changePassword = async (actor: Actor, currentPassword: string, newPassword: string) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) throw badRequest('Current password is incorrect');
  const updated = await prisma.user.update({
    where: { id: actor.id },
    data: { passwordHash: await hashPassword(newPassword), tokenVersion: { increment: 1 } },
  });
  await audit(prisma, actor, { action: 'PASSWORD_CHANGE', entity: 'User', entityId: actor.id });
  return { token: signToken(updated) };
};
