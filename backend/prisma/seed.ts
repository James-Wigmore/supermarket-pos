/* Development seed. Refuses to run in production. */
import { Role } from '@prisma/client';
import { env, isProd } from '../src/config/env';
import { migrate } from '../src/lib/migrate';
import { hashPassword } from '../src/services/auth.service';
import { prisma, transact } from '../src/lib/prisma';
import { createProduct } from '../src/services/product.service';
import { addStock } from '../src/services/stock.service';
import type { Actor } from '../src/types';

if (isProd) throw new Error('The development seed must not run in production. Use `npm run seed:admin` instead.');

export const DEV_PASSWORD = 'Password123!';

const USERS: { email: string; name: string; role: Role }[] = [
  { email: 'admin@supermarket.test', name: 'Super Admin', role: 'SUPER_ADMIN' },
  { email: 'manager@supermarket.test', name: 'Mary Manager', role: 'MANAGER' },
  { email: 'cashier@supermarket.test', name: 'Charles Cashier', role: 'CASHIER' },
  { email: 'stock@supermarket.test', name: 'Sam Stock', role: 'STOCK_OFFICER' },
  { email: 'accountant@supermarket.test', name: 'Alice Accountant', role: 'ACCOUNTANT' },
  { email: 'auditor@supermarket.test', name: 'Aaron Auditor', role: 'AUDITOR' },
];

const CATEGORIES = ['Beverages', 'Dairy', 'Bakery', 'Staples', 'Household', 'Snacks', 'Fresh Produce'];
const SUPPLIERS = [
  { name: 'Kampala Wholesale Ltd', contact: 'John Okello', phone: '+256700000001', email: 'orders@kwholesale.test' },
  { name: 'Fresh Farms Uganda', contact: 'Grace Nakato', phone: '+256700000002', email: 'sales@freshfarms.test' },
];

interface Seed { name: string; brand?: string; category: string; supplier: number; unit: string; cost: number; price: number; tax?: number; min: number; stock: number; barcode?: string; expiry?: boolean }

const PRODUCTS: Seed[] = [
  { name: 'Mineral Water 500ml', brand: 'Rwenzori', category: 'Beverages', supplier: 0, unit: 'pcs', cost: 700, price: 1000, min: 48, stock: 240, barcode: '6001000000011' },
  { name: 'Cola Soda 500ml', brand: 'Coca-Cola', category: 'Beverages', supplier: 0, unit: 'pcs', cost: 1200, price: 1800, tax: 18, min: 48, stock: 144, barcode: '6001000000028' },
  { name: 'Fresh Milk 1L', brand: 'Brookside', category: 'Dairy', supplier: 1, unit: 'pcs', cost: 2400, price: 3200, min: 20, stock: 60, barcode: '6001000000035', expiry: true },
  { name: 'Yoghurt 500ml', brand: 'Fresh Dairy', category: 'Dairy', supplier: 1, unit: 'pcs', cost: 2000, price: 2800, min: 12, stock: 36, barcode: '6001000000042', expiry: true },
  { name: 'Sliced Bread 600g', brand: 'Supabread', category: 'Bakery', supplier: 0, unit: 'pcs', cost: 3200, price: 4000, min: 10, stock: 30, barcode: '6001000000059', expiry: true },
  { name: 'White Sugar 1kg', brand: 'Kinyara', category: 'Staples', supplier: 0, unit: 'pcs', cost: 4200, price: 5500, min: 30, stock: 120, barcode: '6001000000066' },
  { name: 'Cooking Oil 1L', brand: 'Mukwano', category: 'Staples', supplier: 0, unit: 'pcs', cost: 7500, price: 9000, min: 24, stock: 72, barcode: '6001000000073' },
  { name: 'Rice 1kg', brand: 'Pishori', category: 'Staples', supplier: 0, unit: 'pcs', cost: 4800, price: 6000, min: 30, stock: 90, barcode: '6001000000080' },
  { name: 'Laundry Soap Bar', brand: 'Geisha', category: 'Household', supplier: 0, unit: 'pcs', cost: 1500, price: 2200, tax: 18, min: 24, stock: 96, barcode: '6001000000097' },
  { name: 'Salted Crisps 50g', brand: 'Crunchies', category: 'Snacks', supplier: 0, unit: 'pcs', cost: 600, price: 1000, tax: 18, min: 40, stock: 120, barcode: '6001000000103' },
  { name: 'Tomatoes', category: 'Fresh Produce', supplier: 1, unit: 'kg', cost: 2500, price: 4000, min: 10, stock: 40 },
  { name: 'Bananas (Matooke)', category: 'Fresh Produce', supplier: 1, unit: 'kg', cost: 1500, price: 2500, min: 10, stock: 50 },
];

const main = async () => {
  await migrate();
  if (await prisma.branch.findUnique({ where: { code: 'MAIN' } })) {
    console.log('Seed data already present, nothing to do.');
    return;
  }
  const branch = await prisma.branch.create({ data: { code: 'MAIN', name: 'Main Branch', address: 'Kampala Road', phone: '+256700000000' } });
  await prisma.register.createMany({ data: [{ branchId: branch.id, name: 'Register 1' }, { branchId: branch.id, name: 'Register 2' }] });

  const passwordHash = await hashPassword(DEV_PASSWORD);
  const users = await Promise.all(
    USERS.map((u) => prisma.user.create({ data: { ...u, passwordHash, branchId: u.role === 'SUPER_ADMIN' ? null : branch.id } })),
  );
  const admin = users[0]!;
  const actor: Actor = { id: admin.id, name: admin.name, email: admin.email, role: admin.role, branchId: null };

  const categories = new Map<string, string>();
  for (const name of CATEGORIES) categories.set(name, (await prisma.category.create({ data: { name } })).id);
  const suppliers = await Promise.all(SUPPLIERS.map((data) => prisma.supplier.create({ data })));

  const nextWeek = new Date(Date.now() + 7 * 86_400_000);
  for (const p of PRODUCTS) {
    const product = await createProduct(actor, {
      name: p.name, brand: p.brand, unit: p.unit, purchasePrice: p.cost, sellingPrice: p.price, taxRate: p.tax ?? 0,
      minStock: p.min, tracksExpiry: p.expiry ?? false, categoryId: categories.get(p.category), supplierId: suppliers[p.supplier]!.id,
      barcodes: p.barcode ? [p.barcode] : [], generateBarcode: !p.barcode,
    });
    await transact((tx) => addStock(tx, {
      productId: product.id, branchId: branch.id, userId: admin.id, type: 'OPENING', quantity: p.stock, unitCost: p.cost, reference: 'SEED',
      batch: p.expiry ? { batchNo: 'SEED-1', expiryDate: nextWeek } : undefined,
    }));
  }
  console.log(`Seeded branch ${branch.code}, ${users.length} users, ${PRODUCTS.length} products.`);
  console.log(`Development password for every seeded user: ${DEV_PASSWORD} (${env.NODE_ENV})`);
};

main().finally(() => prisma.$disconnect());
