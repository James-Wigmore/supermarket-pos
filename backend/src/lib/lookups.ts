import { prisma } from './prisma';

export const userNames = async (ids: (string | null | undefined)[]) => {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(users.map((user) => [user.id, user.name]));
};
