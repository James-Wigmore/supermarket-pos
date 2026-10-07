import { Router } from 'express';
import { z } from 'zod';
import { labelsPdf } from '../lib/documents';
import { getSettings } from '../lib/settings';
import { pageQuery } from '../lib/pagination';
import { P } from '../lib/permissions';
import { prisma } from '../lib/prisma';
import { authorize } from '../middleware/auth';
import { queryOf, validate } from '../middleware/validate';
import { currentPrices, priceHistory, setPrice } from '../services/pricing.service';
import { lookupBarcode } from '../services/lookup.service';
import * as products from '../services/product.service';
import { idParams } from '../validators/common';
import { addBarcodeSchema, createProductSchema, labelsQuery, lookupQuery, productListQuery, setPriceSchema, updateProductSchema } from '../validators/product';
import { badRequest } from '../lib/errors';

export const productRouter = Router();
const read = authorize(P.PRODUCT_READ);
const write = authorize(P.PRODUCT_WRITE);
const barcodeParams = z.object({ id: z.uuid(), barcodeId: z.uuid() });

productRouter.get('/', read, validate({ query: productListQuery.extend(pageQuery.shape) }), async (req, res) => {
  const { page, pageSize, ...filter } = queryOf<z.infer<typeof productListQuery> & { page: number; pageSize: number }>(req);
  res.json(await products.listProducts(req.actor!, filter, { page, pageSize }));
});

productRouter.get('/lookup/:code', read, validate({ query: lookupQuery }), async (req, res) => {
  res.json(await lookupBarcode(req.actor!, req.params.code as string, queryOf<z.infer<typeof lookupQuery>>(req)));
});

productRouter.get('/labels.pdf', read, validate({ query: labelsQuery }), async (req, res) => {
  const { ids, copies } = queryOf<z.infer<typeof labelsQuery>>(req);
  const found = await prisma.product.findMany({ where: { id: { in: ids } }, include: { barcodes: { orderBy: { isPrimary: 'desc' }, take: 1 } } });
  const prices = await currentPrices(prisma, found.map((p) => p.id));
  const labels = found.flatMap((p) => {
    const code = p.barcodes[0]?.code;
    return code ? Array.from({ length: copies }, () => ({ name: p.name, code, price: prices.get(p.id)?.toNumber() })) : [];
  });
  if (!labels.length) throw badRequest('None of the selected products has a barcode');
  res.type('application/pdf').send(await labelsPdf(labels, (await getSettings()).currency));
});

productRouter.post('/', write, validate({ body: createProductSchema }), async (req, res) => {
  res.status(201).json(await products.createProduct(req.actor!, req.body));
});

productRouter.get('/:id', read, validate({ params: idParams }), async (req, res) => {
  res.json(await products.getProduct(req.actor!, req.params.id as string));
});

productRouter.patch('/:id', write, validate({ params: idParams, body: updateProductSchema }), async (req, res) => {
  res.json(await products.updateProduct(req.actor!, req.params.id as string, req.body));
});

productRouter.delete('/:id', authorize(P.PRODUCT_DELETE), validate({ params: idParams }), async (req, res) => {
  res.json(await products.deleteProduct(req.actor!, req.params.id as string));
});

productRouter.post('/:id/barcodes', write, validate({ params: idParams, body: addBarcodeSchema }), async (req, res) => {
  res.status(201).json(await products.addBarcode(req.actor!, req.params.id as string, req.body.code));
});

productRouter.post('/:id/barcodes/generate', write, validate({ params: idParams }), async (req, res) => {
  res.status(201).json(await products.generateBarcode(req.actor!, req.params.id as string));
});

productRouter.delete('/:id/barcodes/:barcodeId', write, validate({ params: barcodeParams }), async (req, res) => {
  await products.removeBarcode(req.actor!, req.params.id as string, req.params.barcodeId as string);
  res.status(204).end();
});

productRouter.get('/:id/prices', read, validate({ params: idParams }), async (req, res) => {
  res.json(await priceHistory(req.params.id as string));
});

productRouter.post('/:id/prices', authorize(P.PRICE_WRITE), validate({ params: idParams, body: setPriceSchema }), async (req, res) => {
  res.status(201).json(await setPrice(req.actor!, req.params.id as string, req.body));
});
