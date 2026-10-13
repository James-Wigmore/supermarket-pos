import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { forbidden, unauthorized } from '../lib/errors';
import { can, type Permission } from '../lib/permissions';
import { prisma } from '../lib/prisma';
import { Role } from '@prisma/client';

export type TokenScope = 'challenge' | 'setup';

interface TokenPayload {
  sub: string;
  tv: number;
  scope?: TokenScope;
}

const SCOPED_TOKEN_SECONDS = 10 * 60;

/** A normal session token, or (with `scope`) a short-lived token that only works for one two-factor step. */
export const signToken = (user: { id: string; tokenVersion: number }, scope?: TokenScope) =>
  jwt.sign(scope ? { tv: user.tokenVersion, scope } : { tv: user.tokenVersion }, env.JWT_SECRET, {
    subject: user.id,
    algorithm: 'HS256',
    expiresIn: scope ? SCOPED_TOKEN_SECONDS : env.JWT_EXPIRES_IN_SECONDS,
  });

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

/** The user behind a scoped token (second-factor challenge or enrolment). */
export const userFromScopedToken = async (token: string, scope: TokenScope) => {
  const payload = verifyToken(token);
  if (payload.scope !== scope) throw unauthorized('Session expired, please sign in again');
  return loadUser(payload);
};

const asActor = (user: Awaited<ReturnType<typeof loadUser>>, req: Parameters<RequestHandler>[0]) => ({
  id: user.id, name: user.name, email: user.email, role: user.role, branchId: user.branchId, ip: req.ip, userAgent: req.headers['user-agent'],
});

export const authenticate: RequestHandler = async (req, _res, next) => {
  const token = readToken(req.headers.authorization);
  if (!token) throw unauthorized();
  const payload = verifyToken(token);
  if (payload.scope) throw unauthorized('Session expired, please sign in again'); // scoped tokens never open the app
  req.actor = asActor(await loadUser(payload), req);
  next();
};

/** Signed-in user, or someone being forced to enrol (identified by the `setupToken` from their login). */
export const authenticateOrSetup: RequestHandler = async (req, res, next) => {
  const setupToken = (req.body as { setupToken?: string } | undefined)?.setupToken;
  if (!setupToken) {
    await authenticate(req, res, next);
    return;
  }
  req.actor = asActor(await userFromScopedToken(setupToken, 'setup'), req);
  req.setupFlow = true;
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
