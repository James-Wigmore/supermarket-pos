import 'dotenv/config';
import { z } from 'zod';

const list = (value: string) => value.split(',').map((item) => item.trim()).filter(Boolean);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().min(1).default('file:./pos.db'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN_SECONDS: z.coerce.number().int().positive().default(12 * 3600),
  TIMEZONE: z.string().default('Africa/Kampala'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  CORS_ORIGINS: z.string().default('http://localhost:5173').transform(list),
  BARCODE_LOOKUP_PROVIDER: z.enum(['openfoodfacts', 'upcitemdb', 'none']).default('openfoodfacts'),
  BARCODE_LOOKUP_URL: z.url().optional(),
  BARCODE_LOOKUP_API_KEY: z.string().optional(),
  BARCODE_LOOKUP_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
}
if (parsed.data.NODE_ENV === 'production' && parsed.data.JWT_SECRET.includes('dev-only')) {
  throw new Error('JWT_SECRET must be replaced with a production secret');
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
