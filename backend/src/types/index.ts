import type { Role } from '@prisma/client';

export interface Actor {
  id: string;
  name: string;
  email: string;
  role: Role;
  branchId: string | null;
  ip?: string;
  userAgent?: string;
}

/** Manager credentials supplied by a cashier to authorise a restricted action. */
export interface Approval {
  email: string;
  password: string;
}
