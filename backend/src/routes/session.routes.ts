import { Router } from 'express';
import type { z } from 'zod';
import { pageQuery } from '../lib/pagination';
import { P } from '../lib/permissions';
import { authorize } from '../middleware/auth';
import { queryOf, validate } from '../middleware/validate';
import { createReturn, listReturns } from '../services/return.service';
import * as sessions from '../services/session.service';
import { branchQuery, idParams } from '../validators/common';
import { closeSessionSchema, createReturnSchema, openSessionSchema, recountSessionSchema, sessionListQuery } from '../validators/session';

export const sessionRouter = Router();

sessionRouter.get('/', authorize(P.SESSION_OWN), validate({ query: sessionListQuery }), async (req, res) => {
  res.json(await sessions.listSessions(req.actor!, queryOf<z.infer<typeof sessionListQuery>>(req)));
});

sessionRouter.get('/current', authorize(P.SESSION_OWN), async (req, res) => {
  res.json(await sessions.currentSession(req.actor!));
});

sessionRouter.post('/', authorize(P.SESSION_OWN), validate({ body: openSessionSchema }), async (req, res) => {
  res.status(201).json(await sessions.openSession(req.actor!, req.body.registerId, req.body.openingCash));
});

sessionRouter.get('/:id/summary', authorize(P.SESSION_OWN), validate({ params: idParams }), async (req, res) => {
  res.json(await sessions.getSessionSummary(req.actor!, req.params.id as string));
});

sessionRouter.post('/:id/close', authorize(P.SESSION_OWN), validate({ params: idParams, body: closeSessionSchema }), async (req, res) => {
  res.json(await sessions.closeSession(req.actor!, req.params.id as string, req.body.actualCash, req.body.notes));
});

// Correcting a finished count is a manager's job (user:manage, as for closing someone else's shift).
sessionRouter.post('/:id/recount', authorize(P.USER_MANAGE), validate({ params: idParams, body: recountSessionSchema }), async (req, res) => {
  res.json(await sessions.recountSession(req.actor!, req.params.id as string, req.body.actualCash, req.body.reason));
});

export const returnRouter = Router();

returnRouter.get('/', authorize(P.SALE_READ_ALL), validate({ query: pageQuery.extend(branchQuery.shape) }), async (req, res) => {
  res.json(await listReturns(req.actor!, queryOf(req)));
});

// Cashiers may start a return but need a manager's credentials (approval) to complete it.
returnRouter.post('/', authorize(P.SALE_CREATE), validate({ body: createReturnSchema }), async (req, res) => {
  res.status(201).json(await createReturn(req.actor!, req.body));
});
