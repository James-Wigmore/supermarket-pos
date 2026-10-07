/* Applies pending database migrations (`npm run db:migrate`). */
import { migrate } from '../src/lib/migrate';
import { prisma } from '../src/lib/prisma';

migrate()
  .then((applied) => console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date'))
  .finally(() => prisma.$disconnect());
