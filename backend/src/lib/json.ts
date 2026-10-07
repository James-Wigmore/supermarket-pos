import type { Prisma } from '@prisma/client';

/** Converts Decimals/Dates into plain JSON values for Json columns. */
export const toJson = (value: unknown): Prisma.InputJsonValue | undefined =>
  value === undefined || value === null ? undefined : (JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue);
