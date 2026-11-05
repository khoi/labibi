import type { PrismaClient } from "./client.js";

export function findSpaceMemoryConfig(
  prisma: Pick<PrismaClient, "spaceMemoryConfig">,
  spaceId: string,
) {
  return prisma.spaceMemoryConfig.findUnique({ where: { spaceId } });
}
