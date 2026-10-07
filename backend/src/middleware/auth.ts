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
}

export const signToken = (user: { id: string; tokenVersion: number }) =>
  jwt.sign({ tv: user.tokenVersion } satisfies Omit<TokenPayload, 'sub'>, env.JWT_SECRET, {
    subject: user.id,
    algorithm: 'HS256',
    expiresIn: env.JWT_EXPIRES_IN_SECONDS,
  });

const readToken = (header?: string) => (header?.startsWith('Bearer ') ? header.slice(7) : undefined);

export const authenticate: RequestHandler = async (req, _res, next) => {
  const token = readToken(req.headers.authorization);
  if (!token) throw unauthorized();

  let payload: TokenPayload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as unknown as TokenPayload;
  } catch {
    throw unauthorized('Session expired, please sign in again');
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user?.isActive || user.tokenVersion !== payload.tv) throw unauthorized('Session is no longer valid');
  if (user.role !== Role.SUPER_ADMIN && !user.branchId) throw forbidden('No branch assigned to this account');

  req.actor = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    branchId: user.branchId,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  };
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
