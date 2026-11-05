import { writeBotInstructions } from "./bot-instructions.js";
import type { Bot, Prisma, PrismaClient } from "./client.js";
import { requireSpaceOwner } from "./space-members.js";

export type BotUpdate = {
  /** The person making the change; for Doodle's tool, the person who started the run. */
  actor: { spaceId: string; userId: string };
  data: Omit<
    Prisma.BotUncheckedUpdateInput,
    "id" | "spaceId" | "instructions" | "instructionHistory"
  > & {
    instructions?: string;
  };
  expectedInstructions?: string;
  /** Write only while these settings hold; otherwise Prisma throws P2025. */
  expectedSettings?: Partial<Pick<Bot, "modelProvider" | "modelId" | "thinkingLevel" | "voiceId">>;
  instructionRestore?: { versionId: string; undo?: boolean };
  reason?: string;
};

/**
 * The one way Doodle's settings change, from settings and from its own tool alike: only the
 * workspace's owner may, checked in the same transaction as the write. `instructionsChanged` is
 * false when the instructions were already what was asked.
 */
export async function commitBotUpdateInTransaction(
  tx: Prisma.TransactionClient,
  options: BotUpdate,
): Promise<{ bot: Bot; instructionsChanged: boolean }> {
  const { instructions, ...data } = options.data;
  await requireSpaceOwner(tx, options.actor);
  const { id: botId } = await tx.bot.findUniqueOrThrow({
    where: { spaceId: options.actor.spaceId },
    select: { id: true },
  });
  let instructionsChanged = false;
  if (typeof instructions === "string" || options.instructionRestore) {
    instructionsChanged =
      (await writeBotInstructions(tx, {
        botId,
        instructions,
        reason: options.instructionRestore ? "Restore" : (options.reason ?? "Manual edit"),
        expectedInstructions: options.expectedInstructions,
        ...options.instructionRestore,
      })) !== null;
  }
  const bot = await tx.bot.update({ where: { id: botId, ...options.expectedSettings }, data });
  return { bot, instructionsChanged };
}

export async function commitBotUpdate(options: BotUpdate & { prisma: PrismaClient }): Promise<Bot> {
  const { prisma, ...update } = options;
  const { bot } = await prisma.$transaction((tx) => commitBotUpdateInTransaction(tx, update));
  return bot;
}
