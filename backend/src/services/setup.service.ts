import { audit } from '../lib/audit';
import { conflict } from '../lib/errors';
import { prisma, transact } from '../lib/prisma';
import { DEFAULT_SETTINGS, saveSettings } from '../lib/settings';
import type { SetupInput } from '../validators/setup';
import { hashPassword } from './auth.service';

export const needsSetup = async () => (await prisma.user.count()) === 0;

/** First-run setup: creates the branch, registers, administrator and store settings. Only works while there are no users. */
export const runSetup = async (input: SetupInput) => {
  const passwordHash = await hashPassword(input.admin.password);
  await transact(async (tx) => {
    if (await tx.user.count()) throw conflict('Setup has already been completed');
    const branch = await tx.branch.create({ data: input.branch });
    await tx.register.createMany({ data: input.registers.map((name) => ({ branchId: branch.id, name })) });
    await tx.user.create({ data: { email: input.admin.email, name: input.admin.name, role: 'SUPER_ADMIN', passwordHash } });
    await saveSettings({
      ...DEFAULT_SETTINGS,
      currency: input.currency,
      receipt: { storeName: input.businessName, header: input.receiptHeader, footer: input.receiptFooter },
    }, tx);
    await audit(tx, null, { action: 'SETUP_COMPLETE', entity: 'Branch', entityId: branch.id, branchId: branch.id, after: { business: input.businessName } });
  });
};
