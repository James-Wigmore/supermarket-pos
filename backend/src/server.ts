import { createApp } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';
import { migrate } from './lib/migrate';
import { prisma } from './lib/prisma';

const start = async () => {
  await migrate();
  const server = createApp().listen(env.PORT, () => logger.info(`API listening on :${env.PORT}`));

  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

start().catch((err) => {
  logger.error(err, 'Failed to start');
  process.exit(1);
});
