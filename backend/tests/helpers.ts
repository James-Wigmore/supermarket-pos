import { randomUUID } from 'node:crypto';
import { Role } from '@prisma/client';
import request from 'supertest';
import { createApp } from '../src/app';
import { prisma, transact } from '../src/lib/prisma';
import { resetApprovalLocks } from '../src/services/approval.service';
import { hashPassword } from '../src/services/auth.service';
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
  'SyncState', 'SyncLog', 'User', 'Branch',
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

export const createWorld = async () => {
  await resetDb();
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
