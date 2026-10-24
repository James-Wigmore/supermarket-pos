import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { app, auth, createWorld, makeProduct } from './helpers';

const deliver = async (w: Awaited<ReturnType<typeof createWorld>>, token: string, paid?: boolean) => {
  const product = await makeProduct(w, { stock: 0 });
  return request(app).post('/api/purchases/deliveries').set(auth(token)).send({ supplierId: w.supplier.id, paid, items: [{ productId: product.id, quantity: 10, unitCost: 500 }] });
};
const balance = async (id: string) => Number((await prisma.supplier.findUniqueOrThrow({ where: { id } })).balance);

describe('supplier payment status', () => {
  it('records an unpaid delivery as owed and lets a manager mark it paid, then unpaid again', async () => {
    const w = await createWorld();
    const res = await deliver(w, w.users.MANAGER.token);
    expect(res.status).toBe(201);
    expect(res.body.paymentStatus).toBe('UNPAID');
    expect(await balance(w.supplier.id)).toBe(5000);

    const paid = await request(app).patch(`/api/purchases/${res.body.id}/payment`).set(auth(w.users.MANAGER.token)).send({ paid: true });
    expect(paid.body.paymentStatus).toBe('PAID');
    expect(await balance(w.supplier.id)).toBe(0);

    const again = await request(app).patch(`/api/purchases/${res.body.id}/payment`).set(auth(w.users.MANAGER.token)).send({ paid: true });
    expect(again.status).toBe(200);
    expect(await balance(w.supplier.id)).toBe(0); // repeating never pays twice

    await request(app).patch(`/api/purchases/${res.body.id}/payment`).set(auth(w.users.MANAGER.token)).send({ paid: false });
    expect(await balance(w.supplier.id)).toBe(5000);
  });

  it('marks a delivery paid at receiving time only for users allowed to pay suppliers', async () => {
    const w = await createWorld();
    expect((await deliver(w, w.users.STOCK_OFFICER.token, true)).status).toBe(403);
    expect(await prisma.purchase.count()).toBe(0);

    const ok = await deliver(w, w.users.MANAGER.token, true);
    expect(ok.status).toBe(201);
    expect(ok.body.paymentStatus).toBe('PAID');
    expect(await balance(w.supplier.id)).toBe(0);
  });

  it('forbids stock officers and cashiers from changing payment status', async () => {
    const w = await createWorld();
    const res = await deliver(w, w.users.MANAGER.token);
    for (const role of ['STOCK_OFFICER', 'CASHIER'] as const) {
      const r = await request(app).patch(`/api/purchases/${res.body.id}/payment`).set(auth(w.users[role].token)).send({ paid: true });
      expect(r.status).toBe(403);
    }
  });

  it('settles the oldest unpaid purchases first when a lump sum is paid', async () => {
    const w = await createWorld();
    const manager = w.users.MANAGER.token;
    const first = await deliver(w, manager); // owes 5000
    const second = await deliver(w, manager); // owes 5000 more
    expect(await balance(w.supplier.id)).toBe(10000);

    await request(app).post(`/api/suppliers/${w.supplier.id}/payments`).set(auth(manager)).send({ amount: 7000 });
    const status = async (id: string) => prisma.purchase.findUniqueOrThrow({ where: { id } });
    expect((await status(first.body.id)).paymentStatus).toBe('PAID');
    const part = await status(second.body.id);
    expect(part.paymentStatus).toBe('UNPAID');
    expect(Number(part.paidAmount)).toBe(2000);
    expect(await balance(w.supplier.id)).toBe(3000);

    // marking the part-paid purchase paid only pays what is still owed
    await request(app).patch(`/api/purchases/${second.body.id}/payment`).set(auth(manager)).send({ paid: true });
    expect(await balance(w.supplier.id)).toBe(0);
  });
});
