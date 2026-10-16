/* Locked out? Run on the PC that holds the database:
 *   RECOVER_EMAIL=owner@shop.com [RECOVER_PASSWORD='new passphrase'] [RECOVER_NEW_EMAIL=right@address.com] [RECOVER_EMAIL_APPROVAL=off] npm run auth:recover
 * Signs the user out everywhere and cancels pending approvals. Optionally sets a new password, corrects the email address
 * that approval links are sent to, or switches off optional email approval for that account. */
import { z } from 'zod';
import { prisma } from '../src/lib/prisma';
import { recoverAccount } from '../src/services/recovery.service';

const input = z.object({
  RECOVER_EMAIL: z.email(),
  RECOVER_PASSWORD: z.string().min(8).max(72).optional(),
  RECOVER_NEW_EMAIL: z.email().optional(),
  RECOVER_EMAIL_APPROVAL: z.literal('off').optional(),
}).parse(Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== '')));

recoverAccount(input.RECOVER_EMAIL, { newPassword: input.RECOVER_PASSWORD, newEmail: input.RECOVER_NEW_EMAIL, emailApprovalOff: input.RECOVER_EMAIL_APPROVAL === 'off' })
  .then((user) => console.log(`Recovered ${user.email}: signed out everywhere, pending approvals cancelled${input.RECOVER_PASSWORD ? ', password changed' : ''}${input.RECOVER_NEW_EMAIL ? ', email corrected' : ''}${input.RECOVER_EMAIL_APPROVAL ? ', email approval switched off' : ''}.`))
  .catch((err: Error) => { console.error(`Recovery failed: ${err.message}`); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
