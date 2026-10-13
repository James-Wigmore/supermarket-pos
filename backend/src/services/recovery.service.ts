import { audit } from '../lib/audit';
import { notFound } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { clearTwoFactorData, hashPassword } from './auth.service';

/**
 * Last-resort recovery, run on the machine that holds the database (not reachable from the app or the network):
 * switches two-factor off for the account, optionally sets a new password, and signs the user out everywhere.
 */
export const recoverAccount = async (email: string, newPassword?: string) => {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user) throw notFound('User');
  await prisma.user.update({
    where: { id: user.id },
    data: { ...clearTwoFactorData, tokenVersion: { increment: 1 }, ...(newPassword ? { passwordHash: await hashPassword(newPassword) } : {}) },
  });
  await audit(prisma, null, {
    action: 'ACCOUNT_RECOVERY', entity: 'User', entityId: user.id,
    after: { twoFactorReset: true, passwordReset: Boolean(newPassword), via: 'command line' },
  });
  return user;
};
