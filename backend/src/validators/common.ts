import { z } from 'zod';

export const id = z.uuid();
export const idParams = z.object({ id });
export const amount = z.coerce.number().nonnegative().max(1e12);
export const positiveAmount = z.coerce.number().positive().max(1e12);
export const quantity = z.coerce.number().positive().max(1e9);
export const optionalText = z.string().trim().max(500).optional();
export const dateInput = z.coerce.date();

export const approvalSchema = z.object({
  email: z.email().transform((v) => v.toLowerCase()),
  password: z.string().min(1),
});

export const dateRange = z.object({ from: dateInput.optional(), to: dateInput.optional() });
export const branchQuery = z.object({ branchId: id.optional() });
