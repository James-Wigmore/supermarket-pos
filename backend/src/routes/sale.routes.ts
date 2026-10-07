import { Router } from 'express';
import type { z } from 'zod';
import { receiptPdf } from '../lib/documents';
import { P } from '../lib/permissions';
import { authorize } from '../middleware/auth';
import { queryOf, validate } from '../middleware/validate';
import * as sales from '../services/sale.service';
import { idParams } from '../validators/common';
import { createSaleSchema, heldSaleSchema, quoteSchema, saleListQuery, voidSaleSchema } from '../validators/sale';

export const saleRouter = Router();

saleRouter.post('/quote', authorize(P.SALE_CREATE), validate({ body: quoteSchema }), async (req, res) => {
  res.json(await sales.quoteCart(req.body.items));
});

saleRouter.post('/', authorize(P.SALE_CREATE), validate({ body: createSaleSchema }), async (req, res) => {
  const { sale, duplicate } = await sales.createSale(req.actor!, req.body);
  res.status(duplicate ? 200 : 201).json({ ...sale, duplicate });
});

saleRouter.get('/', authorize(P.SALE_READ), validate({ query: saleListQuery }), async (req, res) => {
  res.json(await sales.listSales(req.actor!, queryOf<z.infer<typeof saleListQuery>>(req)));
});

saleRouter.get('/held', authorize(P.SALE_CREATE), async (req, res) => {
  res.json(await sales.listHeld(req.actor!));
});

saleRouter.post('/held', authorize(P.SALE_CREATE), validate({ body: heldSaleSchema }), async (req, res) => {
  res.status(201).json(await sales.holdSale(req.actor!, req.body.label, req.body.payload));
});

saleRouter.post('/held/:id/resume', authorize(P.SALE_CREATE), validate({ params: idParams }), async (req, res) => {
  res.json(await sales.takeHeld(req.actor!, req.params.id as string));
});

saleRouter.get('/:id', authorize(P.SALE_READ), validate({ params: idParams }), async (req, res) => {
  res.json(await sales.getSale(req.actor!, req.params.id as string));
});

saleRouter.get('/:id/receipt', authorize(P.SALE_READ), validate({ params: idParams }), async (req, res) => {
  res.json(await sales.getReceipt(req.actor!, req.params.id as string));
});

saleRouter.get('/:id/receipt.pdf', authorize(P.SALE_READ), validate({ params: idParams }), async (req, res) => {
  res.type('application/pdf').send(await receiptPdf(await sales.getReceipt(req.actor!, req.params.id as string)));
});

saleRouter.post('/:id/void', authorize(P.SALE_READ), validate({ params: idParams, body: voidSaleSchema }), async (req, res) => {
  res.json(await sales.voidSale(req.actor!, req.params.id as string, req.body.reason, req.body.approval));
});
