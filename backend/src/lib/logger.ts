import pino from 'pino';
import { isTest } from '../config/env';

export const logger = pino({
  level: isTest ? 'silent' : 'info',
  redact: ['req.headers.authorization', '*.password', '*.passwordHash', '*.approval'],
});
