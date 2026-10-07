import { Role } from '@prisma/client';
import { z } from 'zod';
import { id } from './common';

export const email = z.email().transform((v) => v.toLowerCase());
export const password = z.string().min(8).max(100);

export const loginSchema = z.object({ email, password: z.string().min(1) });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: password });

export const createUserSchema = z.object({
  email,
  name: z.string().trim().min(1).max(100),
  password,
  role: z.enum(Role),
  branchId: id.optional(),
});

export const updateUserSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  role: z.enum(Role).optional(),
  branchId: id.nullable().optional(),
  isActive: z.boolean().optional(),
  password: password.optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
