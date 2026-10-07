import type { Request, RequestHandler } from 'express';
import type { ZodType } from 'zod';

interface Schemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

const replace = (req: Request, key: 'query' | 'params', value: unknown) =>
  Object.defineProperty(req, key, { value, writable: true, configurable: true });

export const validate =
  (schemas: Schemas): RequestHandler =>
  (req, _res, next) => {
    if (schemas.body) req.body = schemas.body.parse(req.body ?? {});
    if (schemas.query) replace(req, 'query', schemas.query.parse(req.query));
    if (schemas.params) replace(req, 'params', schemas.params.parse(req.params));
    next();
  };

/** Typed access to the validated query string. */
export const queryOf = <T>(req: Request) => req.query as unknown as T;
