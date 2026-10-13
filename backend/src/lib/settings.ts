import { Role } from '@prisma/client';
import { z } from 'zod';
import { prisma, type Db } from './prisma';
import { toJson } from './json';

const KEY = 'app';
const CACHE_MS = 10_000;

export const settingsSchema = z.object({
  currency: z.string().trim().toUpperCase().length(3).default('UGX'),
  allowNegativeStock: z.boolean(),
  discountLimitPercent: z.record(z.enum(Role), z.number().min(0).max(100)),
  loyalty: z.object({ enabled: z.boolean(), unitAmount: z.number().positive() }),
  receipt: z.object({ storeName: z.string().min(1), header: z.string(), footer: z.string() }),
  expiryAlertDays: z.number().int().min(1).max(365),
  twoFactorRequiredRoles: z.array(z.enum(Role)).default(['SUPER_ADMIN', 'MANAGER']),
});

export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  currency: 'UGX',
  allowNegativeStock: false,
  discountLimitPercent: {
    SUPER_ADMIN: 100, MANAGER: 50, CASHIER: 5, STOCK_OFFICER: 0, ACCOUNTANT: 0, AUDITOR: 0,
  },
  loyalty: { enabled: false, unitAmount: 1000 },
  receipt: { storeName: 'Supermarket', header: '', footer: 'Thank you for shopping with us' },
  expiryAlertDays: 30,
  twoFactorRequiredRoles: ['SUPER_ADMIN', 'MANAGER'],
};

let cache: { value: Settings; at: number } | null = null;

/** Pass `tx` when called inside a transaction: SQLite has one connection, so the global client would wait for it. */
export const getSettings = async (db: Db = prisma): Promise<Settings> => {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const row = await db.setting.findUnique({ where: { key: KEY } });
  const stored = (row?.value ?? {}) as Partial<Settings>;
  const value = { ...DEFAULT_SETTINGS, ...stored };
  cache = { value, at: Date.now() };
  return value;
};

export const saveSettings = async (settings: Settings, db: Db = prisma) => {
  await db.setting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: toJson(settings)! },
    update: { value: toJson(settings)! },
  });
  cache = null;
};
