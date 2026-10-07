import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env, isProd } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/error';
import { apiLimiter } from './middleware/rateLimit';
import { api } from './routes';

export const createApp = () => {
  const app = express();
  app.set('trust proxy', isProd ? 1 : false);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGINS, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], maxAge: 600 }));
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', apiLimiter, api);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};
