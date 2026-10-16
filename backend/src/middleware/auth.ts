import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { forbidden, unauthorized } from '../lib/errors';
import { can, type Permission } from '../lib/permissions';
import { prisma } from '../lib/prisma';
import { Role } from '@prisma/client';

interface TokenPayload {
  sub: string;
  tv: number;
  /** Set only on short-lived tokens issued by the old two-factor flow; they are never accepted as a session. */
  scope?: string;
}

export const signToken = (user: { id: string; tokenVersion: number }) =>
  jwt.sign({ tv: user.tokenVersion }, env.JWT_SECRET, { subject: user.id, algorithm: 'HS256', expiresIn: env.JWT_EXPIRES_IN_SECONDS });

const readToken = (header?: string) => (header?.startsWith('Bearer ') ? header.slice(7) : undefined);

const verifyToken = (token: string): TokenPayload => {
  try {
    return jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as unknown as TokenPayload;
  } catch {
    throw unauthorized('Session expired, please sign in again');
  }
};

const loadUser = async (payload: TokenPayload) => {
  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user?.isActive || user.tokenVersion !== payload.tv) throw unauthorized('Session is no longer valid');
  if (user.role !== Role.SUPER_ADMIN && !user.branchId) throw forbidden('No branch assigned to this account');
  return user;
};

const asActor = (user: Awaited<ReturnType<typeof loadUser>>, req: Parameters<RequestHandler>[0]) => ({
  id: user.id, name: user.name, email: user.email, role: user.role, branchId: user.branchId, ip: req.ip, userAgent: req.headers['user-agent'],
});

export const authenticate: RequestHandler = async (req, _res, next) => {
  const token = readToken(req.headers.authorization);
  if (!token) throw unauthorized();
  const payload = verifyToken(token);
  if (payload.scope) throw unauthorized('Session expired, please sign in again'); // leftovers of the old two-factor flow never open the app
  req.actor = asActor(await loadUser(payload), req);
  next();
};

/** Backend permission gate: every listed permission is required. */
export const authorize =
  (...permissions: Permission[]): RequestHandler =>
  (req, _res, next) => {
    const role = req.actor?.role;
    if (!role) throw unauthorized();
    if (!permissions.every((permission) => can(role, permission))) throw forbidden();
    next();
  };
