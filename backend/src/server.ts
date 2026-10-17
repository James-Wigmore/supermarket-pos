import { createApp } from './app';
import { env } from './config/env';
import { audit } from './lib/audit';
import { logger } from './lib/logger';
import { migrate } from './lib/migrate';
import { prisma } from './lib/prisma';
import { checkEmailTransport, emailConfigured } from './services/email.service';
import { sweepApprovals } from './services/login-approval.service';

/** Says plainly, in the log and the audit trail, whether sign-in has its email second step. */
const reportEmailApproval = async () => {
  if (emailConfigured()) {
    await checkEmailTransport();
    return;
  }
  logger.warn('Email login approval is OFF: SMTP_HOST, EMAIL_FROM and PUBLIC_BASE_URL are not set. Everyone signs in with a password only.');
  await audit(prisma, null, { action: 'EMAIL_APPROVAL_OFF', entity: 'System', after: { reason: 'email is not configured', effect: 'sign-in uses a password only' } });
};

const start = async () => {
  await migrate();
  await reportEmailApproval();
  const server = createApp().listen(env.PORT, () => logger.info(`API listening on :${env.PORT}`));
  const sweep = setInterval(() => void sweepApprovals().catch((err) => logger.error(err, 'Approval clean-up failed')), 60_000);
  sweep.unref();

  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    clearInterval(sweep);
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
