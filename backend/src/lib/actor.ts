import type { User } from '@prisma/client';
import type { Actor } from '../types';

export type RequestContext = Pick<Actor, 'ip' | 'userAgent'>;

export const actorOf = (user: Pick<User, 'id' | 'name' | 'email' | 'role' | 'branchId'>, ctx: RequestContext = {}): Actor => ({
  id: user.id, name: user.name, email: user.email, role: user.role, branchId: user.branchId, ...ctx,
});
