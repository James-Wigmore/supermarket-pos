import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { adminRouter } from './admin.routes';
import { approvalPageRouter } from './approval-pages.routes';
import { authRouter } from './auth.routes';
import { branchRouter, registerRouter } from './branch.routes';
import { categoryRouter, customerRouter, expenseRouter, promotionRouter } from './catalog.routes';
import { inventoryRouter } from './inventory.routes';
import { productRouter } from './product.routes';
import { purchaseRouter, supplierRouter } from './purchase.routes';
import { saleRouter } from './sale.routes';
import { setupRouter } from './setup.routes';
import { syncRouter } from './sync.routes';
import { returnRouter, sessionRouter } from './session.routes';
import { userRouter } from './user.routes';

export const api = Router();

api.get('/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});
api.use('/auth', approvalPageRouter, authRouter);
api.use('/setup', setupRouter);

const secured = Router();
secured.use(authenticate);
secured.use('/users', userRouter);
secured.use('/branches', branchRouter);
secured.use('/registers', registerRouter);
secured.use('/products', productRouter);
secured.use('/categories', categoryRouter);
secured.use('/promotions', promotionRouter);
secured.use('/inventory', inventoryRouter);
secured.use('/suppliers', supplierRouter);
secured.use('/purchases', purchaseRouter);
secured.use('/customers', customerRouter);
secured.use('/sales', saleRouter);
secured.use('/returns', returnRouter);
secured.use('/sessions', sessionRouter);
secured.use('/expenses', expenseRouter);
secured.use('/sync', syncRouter);
secured.use(adminRouter);
api.use(secured);
