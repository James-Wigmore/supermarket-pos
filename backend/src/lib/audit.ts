import type { Actor } from '../types';
import type { Db } from './prisma';
import { toJson } from './json';

export interface AuditEntry {
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  branchId?: string | null;
}

export const audit = (db: Db, actor: Actor | null, entry: AuditEntry) =>
  db.auditLog.create({
    data: {
      userId: actor?.id,
      branchId: entry.branchId ?? actor?.branchId,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      before: toJson(entry.before),
      after: toJson(entry.after),
      ip: actor?.ip,
      userAgent: actor?.userAgent?.slice(0, 255),
    },
  });
