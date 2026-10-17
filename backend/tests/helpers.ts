import { randomUUID } from 'node:crypto';
import { Role } from '@prisma/client';
import request from 'supertest';
import { vi } from 'vitest';
import { createApp } from '../src/app';
import { env } from '../src/config/env';
import { prisma, transact } from '../src/lib/prisma';
import { DEFAULT_SETTINGS, saveSettings } from '../src/lib/settings';
import { resetApprovalLocks } from '../src/services/approval.service';
import { hashPassword } from '../src/services/auth.service';
import * as mail from '../src/services/email.service';
import { createProduct } from '../src/services/product.service';
import { addStock } from '../src/services/stock.service';
import type { Actor } from '../src/types';

export const app = createApp();
export const PASSWORD = 'Password123!';

/** Child tables first, so foreign keys never block a delete. AuditLog is append-only and is left alone. */
const TABLES = [
  'ReturnItem', 'Return', 'Payment', 'SaleItem', 'Sale', 'HeldSale', 'CashierSession', 'Register', 'StockMovement',
  'ProductBatch', 'StockLevel', 'PurchaseItem', 'Purchase', 'SupplierPayment', 'SupplierPrice', 'Promotion', 'PriceHistory',
  'Barcode', 'ExternalProductCache', 'Product', 'Category', 'Supplier', 'Customer', 'Expense', 'Setting', 'Counter',
  'SyncState', 'SyncLog', 'LoginApproval', 'User', 'Branch',
];

export const resetDb = async () => {
  for (const table of TABLES) {
    await prisma.$executeRawUnsafe(`DELETE FROM "${table}"`);
  }
  resetApprovalLocks();
};

const ROLES = Object.values(Role);
export type Users = Record<Role, { id: string; email: string; token: string; actor: Actor }>;

const login = async (email: string) => {
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  return res.body.token as string;
};

export const createUserIn = async (role: Role, branchId: string | null, tag = '') => {
  const email = `${role.toLowerCase()}${tag}@test.local`;
  const user = await prisma.user.create({ data: { email, name: `${role}${tag}`, role, branchId, passwordHash: await hashPassword(PASSWORD) } });
  return { id: user.id, email, token: await login(email), actor: { id: user.id, name: user.name, email, role, branchId } as Actor };
};

/** Email approval is required for admins and managers by default; most tests sign users in with a password only. */
export const NO_APPROVAL = { ...DEFAULT_SETTINGS, loginApprovalRequiredRoles: [] };

export const createWorld = async () => {
  await resetDb();
  await saveSettings(NO_APPROVAL);
  const branch = await prisma.branch.create({ data: { code: 'MAIN', name: 'Main' } });
  const other = await prisma.branch.create({ data: { code: 'OTHER', name: 'Other' } });
  const users = {} as Users;
  for (const role of ROLES) users[role] = await createUserIn(role, role === 'SUPER_ADMIN' ? null : branch.id);
  const register = await prisma.register.create({ data: { branchId: branch.id, name: 'Register 1' } });
  const supplier = await prisma.supplier.create({ data: { name: 'Acme Supplies' } });
  const category = await prisma.category.create({ data: { name: 'General' } });
  return { branch, other, users, register, supplier, category };
};

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

interface ProductSpec {
  name?: string;
  price?: number;
  cost?: number;
  stock?: number;
  barcode?: string;
  tax?: number;
  expiry?: Date;
  supplierId?: string;
}

export const makeProduct = async (world: Awaited<ReturnType<typeof createWorld>>, spec: ProductSpec = {}) => {
  const name = spec.name ?? `Product ${randomUUID().slice(0, 6)}`;
  const product = await createProduct(world.users.SUPER_ADMIN.actor, {
    name, unit: 'pcs', purchasePrice: spec.cost ?? 600, sellingPrice: spec.price ?? 1000, taxRate: spec.tax ?? 0, minStock: 5,
    tracksExpiry: Boolean(spec.expiry), barcodes: spec.barcode ? [spec.barcode] : [], generateBarcode: false, supplierId: spec.supplierId,
  });
  if (spec.stock) {
    await transact((tx) => addStock(tx, {
      productId: product.id, branchId: world.branch.id, userId: world.users.SUPER_ADMIN.id, type: 'OPENING', quantity: spec.stock!,
      batch: spec.expiry ? { batchNo: `B-${spec.expiry.toISOString().slice(0, 10)}`, expiryDate: spec.expiry } : undefined,
    }));
  }
  return product;
};

export const stockOf = async (productId: string, branchId: string) =>
  Number((await prisma.stockLevel.findUnique({ where: { productId_branchId: { productId, branchId } } }))?.quantity ?? 0);

export const openShift = async (world: Awaited<ReturnType<typeof createWorld>>, role: Role = 'CASHIER', openingCash = 10000) => {
  const res = await request(app).post('/api/sessions').set(auth(world.users[role].token)).send({ registerId: world.register.id, openingCash });
  return res.body.id as string;
};

export const sellBody = (sessionId: string, items: object[], payments: object[], extra: object = {}) => ({
  clientId: randomUUID(), sessionId, items, payments, ...extra,
});

export const loginRaw = (email: string, password = PASSWORD) => request(app).post('/api/auth/login').send({ email, password });

/** Pretends a mail server is configured and captures every email instead of sending it. Call `restore()` afterwards. */
export const withEmail = () => {
  const outbox: mail.EmailMessage[] = [];
  Object.assign(env, { SMTP_HOST: 'smtp.test', EMAIL_FROM: 'pos@shop.test', PUBLIC_BASE_URL: 'https://pos.shop.test' });
  const spy = vi.spyOn(mail, 'sendEmail').mockImplementation(async (message) => { outbox.push(message); });
  return {
    outbox,
    failWith: (error: Error) => spy.mockImplementation(async (message) => { outbox.push(message); throw error; }),
    restore: () => { Object.assign(env, { SMTP_HOST: undefined, EMAIL_FROM: undefined, PUBLIC_BASE_URL: undefined, SMTP_PASS: undefined, SMTP_USER: undefined }); spy.mockRestore(); },
  };
};

/** The approve or reject link (path and token) inside a captured email. */
export const linkIn = (message: mail.EmailMessage, action: 'approve' | 'reject') => {
  const match = new RegExp(`https://pos\\.shop\\.test(/api/auth/${action})\\?token=([\\w-]+)`).exec(message.text);
  if (!match) throw new Error(`No ${action} link in email`);
  return { path: match[1]!, token: match[2]! };
};
