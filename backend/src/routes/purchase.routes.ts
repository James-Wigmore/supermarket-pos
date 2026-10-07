import { Router } from 'express';
import { z } from 'zod';
import { crudRouter } from '../lib/crud';
import { P } from '../lib/permissions';
import { prisma } from '../lib/prisma';
import { authorize } from '../middleware/auth';
import { queryOf, validate } from '../middleware/validate';
import * as purchases from '../services/purchase.service';
import { idParams } from '../validators/common';
import { createPurchaseSchema, purchaseListQuery, receivePurchaseSchema, supplierPaymentSchema } from '../validators/purchase';

export const purchaseRouter = Router();
const read = authorize(P.PURCHASE_READ);
const write = authorize(P.PURCHASE_WRITE);

purchaseRouter.get('/', read, validate({ query: purchaseListQuery }), async (req, res) => {
  res.json(await purchases.listPurchases(req.actor!, queryOf<z.infer<typeof purchaseListQuery>>(req)));
});

purchaseRouter.post('/', write, validate({ body: createPurchaseSchema }), async (req, res) => {
  res.status(201).json(await purchases.createPurchase(req.actor!, req.body));
});

// Receiving mode: a scanned delivery is booked straight into stock after review.
purchaseRouter.post('/deliveries', authorize(P.STOCK_RECEIVE), validate({ body: createPurchaseSchema }), async (req, res) => {
  res.status(201).json(await purchases.receiveDelivery(req.actor!, req.body));
});

purchaseRouter.get('/:id', read, validate({ params: idParams }), async (req, res) => {
  res.json(await purchases.getPurchase(req.actor!, req.params.id as string));
});

purchaseRouter.post('/:id/receive', authorize(P.STOCK_RECEIVE), validate({ params: idParams, body: receivePurchaseSchema }), async (req, res) => {
  res.json(await purchases.receivePurchase(req.actor!, req.params.id as string, req.body.items));
});

purchaseRouter.post('/:id/cancel', write, validate({ params: idParams }), async (req, res) => {
  res.json(await purchases.cancelPurchase(req.actor!, req.params.id as string));
});

const optional = z.string().trim().max(200).optional();
const supplierFields = { contact: optional, phone: z.string().trim().max(30).optional(), email: z.email().optional(), address: optional };

export const supplierRouter = crudRouter({
  entity: 'Supplier',
  delegate: prisma.supplier,
  read: P.SUPPLIER_READ,
  write: P.SUPPLIER_WRITE,
  createSchema: z.object({ name: z.string().trim().min(1).max(150), ...supplierFields }),
  updateSchema: z.object({ name: z.string().trim().min(1).max(150), isActive: z.boolean(), ...supplierFields }).partial(),
  search: ['name', 'contact', 'phone'],
  orderBy: { name: 'asc' },
});

supplierRouter.get('/:id/history', authorize(P.SUPPLIER_READ), validate({ params: idParams }), async (req, res) => {
  res.json(await purchases.supplierHistory(req.params.id as string));
});

supplierRouter.post('/:id/payments', authorize(P.SUPPLIER_WRITE), validate({ params: idParams, body: supplierPaymentSchema }), async (req, res) => {
  res.status(201).json(await purchases.paySupplier(req.actor!, req.params.id as string, req.body.amount, req.body.note));
});

supplierRouter.get('/:id/prices', authorize(P.SUPPLIER_READ), validate({ params: idParams }), async (req, res) => {
  res.json(await prisma.supplierPrice.findMany({ where: { supplierId: req.params.id as string }, include: { product: { select: { name: true, sku: true } } } }));
});
