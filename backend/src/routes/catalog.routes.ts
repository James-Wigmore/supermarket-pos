import { z } from 'zod';
import { crudRouter } from '../lib/crud';
import { conflict } from '../lib/errors';
import { assertCategoryNameFree } from '../services/category.service';
import { P } from '../lib/permissions';
import { prisma } from '../lib/prisma';
import { authorize } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { amount, dateInput, id, idParams } from '../validators/common';

const name = z.string().trim().min(1).max(100);
const blankToUndefined = (v: unknown) => (v === '' ? undefined : v);

const categoryName = name.transform((value) => value.replace(/\s+/g, ' '));

const rejectCategoryInUse = async (category: Record<string, unknown>) => {
  const used = await prisma.product.count({ where: { categoryId: category.id as string } });
  if (used) throw conflict(`“${category.name}” is assigned to ${used} product${used === 1 ? '' : 's'}. Reassign them to another category first.`);
};

export const categoryRouter = crudRouter({
  entity: 'Category',
  delegate: prisma.category,
  read: P.PRODUCT_READ,
  write: P.PRODUCT_WRITE,
  createSchema: z.object({ name: categoryName }),
  updateSchema: z.object({ name: categoryName }),
  search: ['name'],
  orderBy: { name: 'asc' },
  include: { _count: { select: { products: true } } },
  deletable: true,
  beforeSave: (data, id) => assertCategoryNameFree(prisma, data.name as string, id),
  beforeDelete: rejectCategoryInUse,
});

const customerFields = {
  phone: z.preprocess(blankToUndefined, z.string().trim().min(5).max(30).optional()),
  email: z.preprocess(blankToUndefined, z.email().optional()),
};

export const customerRouter = crudRouter({
  entity: 'Customer',
  delegate: prisma.customer,
  read: P.CUSTOMER_READ,
  write: P.CUSTOMER_WRITE,
  createSchema: z.object({ name, ...customerFields }),
  updateSchema: z.object({ name, ...customerFields }).partial(),
  search: ['name', 'phone', 'email'],
  orderBy: { name: 'asc' },
});

customerRouter.get('/:id/purchases', authorize(P.CUSTOMER_READ), validate({ params: idParams }), async (req, res) => {
  res.json(await prisma.sale.findMany({
    where: { customerId: req.params.id as string, status: 'COMPLETED' },
    orderBy: { soldAt: 'desc' }, take: 100, select: { id: true, receiptNo: true, soldAt: true, total: true },
  }));
});

const promotionFields = z.object({
  name,
  type: z.enum(['PERCENT', 'FIXED', 'PROMO_PRICE', 'BULK', 'BOGO']),
  value: amount.default(0),
  minQty: z.coerce.number().positive().default(1),
  buyQty: z.coerce.number().int().min(1).default(1),
  getQty: z.coerce.number().int().min(1).default(1),
  productId: id.nullable().optional(),
  startsAt: dateInput,
  endsAt: dateInput.nullable().optional(),
  isActive: z.boolean().default(true),
});

export const promotionRouter = crudRouter({
  entity: 'Promotion',
  delegate: prisma.promotion,
  read: P.PRODUCT_READ,
  write: P.PROMOTION_MANAGE,
  createSchema: promotionFields.refine((p) => p.type !== 'PERCENT' || p.value <= 100, { message: 'Percent cannot exceed 100', path: ['value'] }),
  updateSchema: promotionFields.partial(),
  search: ['name'],
  orderBy: { startsAt: 'desc' },
  include: { product: { select: { name: true } } },
  deletable: true,
});

export const expenseRouter = crudRouter({
  entity: 'Expense',
  delegate: prisma.expense,
  read: P.EXPENSE_READ,
  write: P.EXPENSE_WRITE,
  createSchema: z.object({ category: name, amount: amount.refine((v) => v > 0, 'Amount must be positive'), description: z.string().trim().max(300).optional(), incurredAt: dateInput.optional(), branchId: id.optional() }),
  updateSchema: z.object({ category: name, amount, description: z.string().trim().max(300), incurredAt: dateInput }).partial(),
  search: ['category', 'description'],
  orderBy: { incurredAt: 'desc' },
  branchScoped: true,
  dateField: 'incurredAt',
  stamp: (actor) => ({ userId: actor.id }),
  deletable: true,
});

