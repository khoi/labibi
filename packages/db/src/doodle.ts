import type { Doodle } from "@labradoodle/contracts";
import {
  canonicalPiProviderId,
  disabledBuiltinToolSet,
  InstructionVersionSchema,
} from "@labradoodle/contracts";
import type { Bot, Prisma, PrismaClient } from "./client.js";
import { isOwnerRole } from "./organization-roles.js";
import { IsolationError } from "./scope.js";

/** The workspace's one Doodle, made with the workspace and kept until it goes. */
export async function ensureSpaceDoodle(
  db: Pick<Prisma.TransactionClient, "bot">,
  spaceId: string,
): Promise<{ id: string }> {
  return db.bot.upsert({
    where: { spaceId },
    create: { spaceId },
    update: {},
    select: { id: true },
  });
}

export function mapDoodle(bot: Bot, canCustomize: boolean): Doodle {
  return {
    id: bot.id,
    spaceId: bot.spaceId,
    instructions: bot.instructions,
    instructionHistory: InstructionVersionSchema.array().parse(bot.instructionHistory ?? []),
    voiceId: bot.voiceId,
    modelProvider: bot.modelProvider ? canonicalPiProviderId(bot.modelProvider) : null,
    modelId: bot.modelId,
    thinkingLevel: (bot.thinkingLevel as Doodle["thinkingLevel"]) ?? null,
    // Stored lists may name a tool that no longer exists; settings resend what they read.
    disabledBuiltinTools: [...disabledBuiltinToolSet(bot.disabledBuiltinTools)],
    canCustomize,
    updatedAt: bot.updatedAt.toISOString(),
  };
}

/** The workspace's Doodle as one of its people sees it; only its owner may customize it. */
export async function getSpaceDoodle(
  prisma: Pick<PrismaClient, "bot" | "spaceMember">,
  actor: { spaceId: string; userId: string },
): Promise<Doodle> {
  const [bot, membership] = await Promise.all([
    prisma.bot.findUnique({ where: { spaceId: actor.spaceId } }),
    prisma.spaceMember.findUnique({
      where: { spaceId_userId: { spaceId: actor.spaceId, userId: actor.userId } },
      select: { role: true },
    }),
  ]);
  if (!bot || !membership) throw new IsolationError();
  return mapDoodle(bot, isOwnerRole(membership.role));
}
