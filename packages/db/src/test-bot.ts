import { createHash } from "node:crypto";
import type { SignupPolicyEnv } from "./bootstrap-user.js";
import { bootstrapUserSpace } from "./bootstrap-user.js";
import type { PrismaClient } from "./client.js";

/**
 * A person with their own Space, its Doodle and their first chat with it, for database suites;
 * the same key returns the same person.
 */
export async function provisionTestBot(
  prisma: PrismaClient,
  request: { address: string; displayName?: string | null },
  env: SignupPolicyEnv,
) {
  const id = `${createHash("sha256").update(request.address).digest("hex")}-test`;
  const user = await prisma.user.upsert({
    where: { id },
    update: {},
    create: {
      id,
      name: request.displayName ?? "Test person",
      email: `${id}@example.test`,
      emailVerified: false,
    },
  });
  const membership = await prisma.spaceMember.findFirst({
    where: { userId: user.id, space: { deletingAt: null } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const created = !membership;
  const spaceId = membership?.spaceId ?? (await bootstrapUserSpace(prisma, user, env)).spaceId;
  const [bot, thread] = await Promise.all([
    prisma.bot.findUniqueOrThrow({ where: { spaceId }, select: { id: true } }),
    prisma.thread.findFirst({
      where: { spaceId, members: { some: { userId: user.id } } },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    }),
  ]);
  if (!thread) throw new Error(`${user.id} has no chat`);
  return {
    address: request.address,
    userId: user.id,
    spaceId,
    botId: bot.id,
    threadId: thread.id,
    created,
  };
}
