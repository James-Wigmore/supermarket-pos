import type { ErrorRequestHandler, RequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { isProd } from '../config/env';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';

const body = (status: number, code: string, message: string, details?: unknown) => ({
  status,
  payload: { error: { code, message, details } },
});

const translate = (err: unknown) => {
  if (err instanceof AppError) return body(err.status, err.code, err.message, err.details);
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return body(400, 'VALIDATION_ERROR', details[0] ? `${details[0].path}: ${details[0].message}`.replace(/^: /, '') : 'Invalid input', details);
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return body(409, 'CONFLICT', 'A record with the same unique value already exists');
    if (err.code === 'P2025') return body(404, 'NOT_FOUND', 'Record not found');
    if (err.code === 'P2003') return body(409, 'CONFLICT', 'Record is referenced by other data');
  }
  const type = (err as { type?: string }).type;
  if (type === 'entity.too.large') return body(413, 'PAYLOAD_TOO_LARGE', 'Request body too large');
  if (type === 'entity.parse.failed') return body(400, 'BAD_REQUEST', 'Malformed JSON body');
  return null;
};

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` } });
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const known = translate(err);
  if (known) {
    res.status(known.status).json(known.payload);
    return;
  }
  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');
  res.status(500).json({
    error: { code: 'INTERNAL', message: isProd ? 'Internal server error' : String((err as Error)?.message) },
  });
};
