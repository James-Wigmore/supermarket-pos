/* Production bootstrap: creates the first branch and super admin from environment variables. */
import { z } from 'zod';
import { migrate } from '../src/lib/migrate';
import { hashPassword } from '../src/services/auth.service';
import { prisma } from '../src/lib/prisma';

const input = z
  .object({
    ADMIN_EMAIL: z.email(),
    ADMIN_PASSWORD: z.string().min(12, 'ADMIN_PASSWORD must be at least 12 characters'),
    ADMIN_NAME: z.string().default('Administrator'),
    BRANCH_NAME: z.string().default('Main Branch'),
  })
  .parse(process.env);

const main = async () => {
  await migrate();
  if (await prisma.user.findUnique({ where: { email: input.ADMIN_EMAIL.toLowerCase() } })) {
    console.log('Admin already exists, nothing to do.');
    return;
  }
  const branch = await prisma.branch.upsert({ where: { code: 'MAIN' }, update: {}, create: { code: 'MAIN', name: input.BRANCH_NAME } });
  await prisma.register.upsert({ where: { branchId_name: { branchId: branch.id, name: 'Register 1' } }, update: {}, create: { branchId: branch.id, name: 'Register 1' } });
  await prisma.user.create({
    data: { email: input.ADMIN_EMAIL.toLowerCase(), name: input.ADMIN_NAME, role: 'SUPER_ADMIN', passwordHash: await hashPassword(input.ADMIN_PASSWORD) },
  });
  console.log(`Created super admin ${input.ADMIN_EMAIL} and branch ${branch.code}.`);
};

main().finally(() => prisma.$disconnect());
