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
  /** Set only on the short-lived two-factor challenge token; never accepted as a session. */
  scope?: string;
}

export const signToken = (user: { id: string; tokenVersion: number }) =>
  jwt.sign({ tv: user.tokenVersion }, env.JWT_SECRET, { subject: user.id, algorithm: 'HS256', expiresIn: env.JWT_EXPIRES_IN_SECONDS });

const TWO_FACTOR_SCOPE = 'totp';
const TWO_FACTOR_TTL_SECONDS = 5 * 60;

/** Proves the password was correct without being a session: `authenticate` above refuses any token carrying a scope. */
export const signTwoFactorChallenge = (user: { id: string; tokenVersion: number }) =>
  jwt.sign({ tv: user.tokenVersion, scope: TWO_FACTOR_SCOPE }, env.JWT_SECRET, { subject: user.id, algorithm: 'HS256', expiresIn: TWO_FACTOR_TTL_SECONDS });

export const verifyTwoFactorChallenge = (token: string) => {
  const payload = verifyToken(token);
  if (payload.scope !== TWO_FACTOR_SCOPE) throw unauthorized('Session expired, please sign in again');
  return { id: payload.sub, tokenVersion: payload.tv };
};

const readToken = (header?: string) => (header?.startsWith('Bearer ') ? header.slice(7) : undefined);

function verifyToken(token: string): TokenPayload {
  try {
    return jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as unknown as TokenPayload;
  } catch {
    throw unauthorized('Session expired, please sign in again');
  }
}

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
  if (payload.scope) throw unauthorized('Session expired, please sign in again'); // a two-factor challenge token never opens the app by itself
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
