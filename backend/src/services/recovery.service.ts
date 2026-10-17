import { audit } from '../lib/audit';
import { conflict, notFound } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { hashPassword } from './auth.service';
import { cancelOpenApprovals } from './login-approval.service';

export interface RecoveryOptions {
  newPassword?: string;
  /** Replaces the address approval emails go to (the usual fix for a mistyped or lost mailbox). */
  newEmail?: string;
  /** Switches off the user's optional email approval. Has no effect where their role requires it. */
  emailApprovalOff?: boolean;
}

/**
 * Last-resort recovery, run on the machine that holds the database (not reachable from the app or the network):
 * signs the user out everywhere, cancels pending approvals and optionally sets a new password or email address.
 */
export const recoverAccount = async (email: string, { newPassword, newEmail, emailApprovalOff }: RecoveryOptions = {}) => {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user) throw notFound('User');
  const changedEmail = newEmail?.trim().toLowerCase();
  if (changedEmail && changedEmail !== user.email && (await prisma.user.findUnique({ where: { email: changedEmail } }))) throw conflict('Another account already uses that email');
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      tokenVersion: { increment: 1 },
      ...(newPassword ? { passwordHash: await hashPassword(newPassword) } : {}),
      ...(changedEmail ? { email: changedEmail } : {}),
      ...(emailApprovalOff ? { emailApprovalEnabled: false } : {}),
    },
  });
  await cancelOpenApprovals(user.id, 'account recovery', null);
  await audit(prisma, null, {
    action: 'ACCOUNT_RECOVERY', entity: 'User', entityId: user.id,
    after: { passwordReset: Boolean(newPassword), emailChanged: Boolean(changedEmail), emailApprovalOff: Boolean(emailApprovalOff), via: 'command line' },
  });
  return updated;
};
