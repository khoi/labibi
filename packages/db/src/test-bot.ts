import { createHash } from "node:crypto";
import type { SignupPolicyEnv } from "./bootstrap-user.js";
import { bootstrapUserSpace } from "./bootstrap-user.js";
import type { PrismaClient } from "./client.js";
import { createRepos } from "./repos.js";

/** A person with their own Space and one bot for database suites; the same key returns the same person. */
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
  const spaceId = membership?.spaceId ?? (await bootstrapUserSpace(prisma, user, env)).spaceId;
  const existing = await prisma.bot.findFirst({
    where: { spaceId, userId: user.id, archivedAt: null },
    select: { id: true },
  });
  const created = !existing;
  const botId =
    existing?.id ??
    (
      await createRepos(prisma).createBot(
        { userId: user.id, spaceId, email: user.email, isDeploymentOwner: false },
        { name: "Assistant", instructions: "", notifyOnFinish: true },
      )
    ).id;
  const thread = await prisma.thread.findFirst({ where: { botId } });
  if (!thread) throw new Error(`bot ${botId} has no thread`);
  return {
    address: request.address,
    userId: user.id,
    spaceId,
    botId,
    threadId: thread.id,
    created,
  };
}
