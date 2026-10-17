import 'dotenv/config';
import { z } from 'zod';

const list = (value: string) => value.split(',').map((item) => item.trim()).filter(Boolean);
/** A blank line in .env (`SMTP_HOST=`) means "not set". */
const present = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== ''));

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

  // Email login approval. Leave SMTP_HOST, EMAIL_FROM and PUBLIC_BASE_URL unset to run without it (the app then says so).
  PUBLIC_BASE_URL: z.url().optional(),
  EMAIL_FROM: z.string().min(3).optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
});

const parsed = schema.safeParse(present);
if (!parsed.success) throw new Error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);

const { data } = parsed;
if (data.NODE_ENV === 'production' && data.JWT_SECRET.includes('dev-only')) throw new Error('JWT_SECRET must be replaced with a production secret');

/** Half-configured email is a mistake worth failing on: it would silently leave sign-in without its second step. */
const emailProblems = [
  (data.SMTP_HOST || data.EMAIL_FROM || data.PUBLIC_BASE_URL) && !(data.SMTP_HOST && data.EMAIL_FROM && data.PUBLIC_BASE_URL) && 'SMTP_HOST, EMAIL_FROM and PUBLIC_BASE_URL must all be set together (or all left empty to run without email approval)',
  Boolean(data.SMTP_USER) !== Boolean(data.SMTP_PASS) && 'SMTP_USER and SMTP_PASS must be set together',
  data.EMAIL_FROM && !z.email().safeParse(data.EMAIL_FROM.replace(/^.*<(.+)>\s*$/, '$1')).success && 'EMAIL_FROM must be an address such as pos@yourshop.com or "Shop POS <pos@yourshop.com>"',
  data.NODE_ENV === 'production' && data.PUBLIC_BASE_URL && !data.PUBLIC_BASE_URL.startsWith('https://') && 'PUBLIC_BASE_URL must start with https:// in production',
].filter(Boolean);
if (emailProblems.length) throw new Error(`Invalid email configuration:\n- ${emailProblems.join('\n- ')}`);

export const env = data;
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
