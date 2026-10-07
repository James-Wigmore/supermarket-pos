import { Role } from '@prisma/client';
import type { Actor } from '../types';
import { badRequest, forbidden } from './errors';

/** Branch filter for reads: undefined means "all branches" (super admin only). */
export const branchFor = (actor: Actor, requested?: string): string | undefined => {
  if (actor.role === Role.SUPER_ADMIN) return requested ?? actor.branchId ?? undefined;
  if (requested && requested !== actor.branchId) throw forbidden('You can only access your own branch');
  return actor.branchId ?? undefined;
};

/** Branch for writes: always a concrete branch id. */
export const requireBranch = (actor: Actor, requested?: string): string => {
  const branchId = branchFor(actor, requested);
  if (!branchId) throw badRequest('branchId is required');
  return branchId;
};
