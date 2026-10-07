import { Prisma } from '@prisma/client';

export const Decimal = Prisma.Decimal;
export type Decimal = Prisma.Decimal;
export type Num = Prisma.Decimal.Value;

export const d = (value: Num | null | undefined) => new Prisma.Decimal(value ?? 0);
export const ZERO = d(0);
export const sum = (values: Num[]) => values.reduce<Decimal>((acc, v) => acc.plus(v), ZERO);
export const money = (value: Num) => d(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
export const qty = (value: Num) => d(value).toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
