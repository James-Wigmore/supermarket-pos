/* Locked-out owner? Run on the PC that holds the database:
 *   RECOVER_EMAIL=owner@shop.com [RECOVER_PASSWORD='new passphrase'] npm run auth:recover
 * Turns two-factor off for that account (they enrol again at the next sign-in) and optionally sets a new password. */
import { z } from 'zod';
import { prisma } from '../src/lib/prisma';
import { recoverAccount } from '../src/services/recovery.service';

const input = z.object({ RECOVER_EMAIL: z.email(), RECOVER_PASSWORD: z.string().min(8).max(72).optional() }).parse(process.env);

recoverAccount(input.RECOVER_EMAIL, input.RECOVER_PASSWORD)
  .then((user) => console.log(`Two-factor reset for ${user.email}${input.RECOVER_PASSWORD ? ' and password changed' : ''}. They were signed out everywhere.`))
  .catch((err: Error) => { console.error(`Recovery failed: ${err.message}`); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
