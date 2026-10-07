import { Router } from 'express';
import { P } from '../lib/permissions';
import { authorize } from '../middleware/auth';
import { validate } from '../middleware/validate';
import * as users from '../services/user.service';
import { createUserSchema, updateUserSchema } from '../validators/auth';
import { branchQuery, idParams } from '../validators/common';

export const userRouter = Router();
userRouter.use(authorize(P.USER_MANAGE));

userRouter.get('/', validate({ query: branchQuery }), async (req, res) => {
  res.json(await users.listUsers(req.actor!, (req.query as { branchId?: string }).branchId));
});

userRouter.post('/', validate({ body: createUserSchema }), async (req, res) => {
  res.status(201).json(await users.createUser(req.actor!, req.body));
});

userRouter.patch('/:id', validate({ params: idParams, body: updateUserSchema }), async (req, res) => {
  res.json(await users.updateUser(req.actor!, req.params.id as string, req.body));
});
