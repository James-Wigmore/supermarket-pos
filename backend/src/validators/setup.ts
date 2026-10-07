import { z } from 'zod';
import { email, password } from './auth';

const name = (max: number) => z.string().trim().min(1).max(max);
const uniqueNames = (names: string[]) => new Set(names.map((n) => n.toLowerCase())).size === names.length;

export const setupSchema = z.object({
  businessName: name(100),
  currency: z.string().trim().toUpperCase().length(3).default('UGX'),
  receiptHeader: z.string().trim().max(200).default(''),
  receiptFooter: z.string().trim().max(200).default('Thank you for shopping with us'),
  branch: z.object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,10}$/).default('MAIN'),
    name: name(100).default('Main Branch'),
    address: z.string().trim().max(200).optional(),
    phone: z.string().trim().max(30).optional(),
  }),
  registers: z.array(name(50)).min(1).max(20).refine(uniqueNames, 'Register names must be different').default(['Register 1']),
  admin: z.object({ name: name(100), email, password }),
});

export type SetupInput = z.infer<typeof setupSchema>;
