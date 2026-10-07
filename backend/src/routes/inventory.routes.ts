import { Router } from 'express';
import type { z } from 'zod';
import { P } from '../lib/permissions';
import { authorize } from '../middleware/auth';
import { queryOf, validate } from '../middleware/validate';
import * as inventory from '../services/inventory.service';
import { adjustStockSchema, batchQuery, movementQuery, stockOverviewQuery, transferStockSchema } from '../validators/stock';

export const inventoryRouter = Router();
const read = authorize(P.STOCK_READ);

inventoryRouter.get('/', read, validate({ query: stockOverviewQuery }), async (req, res) => {
  res.json(await inventory.stockOverview(req.actor!, queryOf<z.infer<typeof stockOverviewQuery>>(req)));
});

inventoryRouter.get('/movements', read, validate({ query: movementQuery }), async (req, res) => {
  res.json(await inventory.listMovements(req.actor!, queryOf<z.infer<typeof movementQuery>>(req)));
});

inventoryRouter.get('/batches', read, validate({ query: batchQuery }), async (req, res) => {
  res.json(await inventory.listBatches(req.actor!, queryOf<z.infer<typeof batchQuery>>(req)));
});

inventoryRouter.post('/adjust', authorize(P.STOCK_ADJUST), validate({ body: adjustStockSchema }), async (req, res) => {
  await inventory.adjustStock(req.actor!, req.body);
  res.status(201).json({ ok: true });
});

inventoryRouter.post('/transfer', authorize(P.STOCK_TRANSFER), validate({ body: transferStockSchema }), async (req, res) => {
  res.status(201).json(await inventory.transferStock(req.actor!, req.body));
});
