import bcrypt from 'bcryptjs';
import { Role } from '@prisma/client';
import { audit } from '../lib/audit';
import { AppError, forbidden } from '../lib/errors';
import { can, type Permission } from '../lib/permissions';
import type { Db } from '../lib/prisma';
import type { Actor, Approval } from '../types';

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60_000;
const failures = new Map<string, { count: number; resetAt: number }>();

const registerFailure = (actorId: string) => {
  const now = Date.now();
  const entry = failures.get(actorId);
  const next = entry && entry.resetAt > now ? { ...entry, count: entry.count + 1 } : { count: 1, resetAt: now + WINDOW_MS };
  failures.set(actorId, next);
};

const assertNotLocked = (actorId: string) => {
  const entry = failures.get(actorId);
  if (entry && entry.resetAt > Date.now() && entry.count >= MAX_FAILURES) {
    throw new AppError(429, 'Too many failed approval attempts, try again later', 'RATE_LIMITED');
  }
};

export const resetApprovalLocks = () => failures.clear();

/**
 * Returns the user authorising a restricted action: the actor if their role already
 * has the permission, otherwise the manager whose credentials were supplied.
 */
export const authorizeAction = async (
  db: Db,
  actor: Actor,
  permission: Permission,
  approval: Approval | undefined,
  branchId: string,
  detail: { action: string; entity: string; entityId?: string },
  accept: (role: Role) => boolean = () => true,
) => {
  if (can(actor.role, permission)) return { id: actor.id, role: actor.role };
  if (!approval) throw forbidden('Manager approval is required for this action');
  assertNotLocked(actor.id);

  const approver = await db.user.findUnique({ where: { email: approval.email } });
  const valid = approver?.isActive && (await bcrypt.compare(approval.password, approver.passwordHash));
  const inBranch = approver && (approver.role === Role.SUPER_ADMIN || approver.branchId === branchId);
  if (!approver || !valid || !inBranch || !can(approver.role, permission) || !accept(approver.role)) {
    registerFailure(actor.id);
    throw forbidden('Invalid manager approval');
  }
  failures.delete(actor.id);
  await audit(db, actor, {
    action: 'MANAGER_APPROVAL',
    entity: detail.entity,
    entityId: detail.entityId,
    after: { approvedBy: approver.id, permission, requested: detail.action },
    branchId,
  });
  return { id: approver.id, role: approver.role };
};
