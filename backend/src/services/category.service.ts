import { conflict } from '../lib/errors';
import type { Db } from '../lib/prisma';

/** "Dairy", "dairy" and "DAIRY" are the same category. Used by the API and by Google Sheets edits alike. */
export const assertCategoryNameFree = async (db: Db, name: string, exceptId = '') => {
  const clash = await db.$queryRaw<{ id: string }[]>`SELECT id FROM "Category" WHERE lower(name) = lower(${name}) AND id <> ${exceptId}`;
  if (clash.length) throw conflict(`A category named “${name}” already exists`);
};
