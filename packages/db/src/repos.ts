import type { Actor, Bot, MessageBlock, SpaceBot } from "@labradoodle/contracts";
import {
  canonicalPiProviderId,
  disabledBuiltinToolSet,
  InstructionVersionSchema,
  initialBotMemory,
} from "@labradoodle/contracts";
import { BACKGROUND_RUN_TRIGGERS, displayName, userVisibleMessages } from "@labradoodle/core";
import { chooseBotAvatar } from "./bot-avatar-choice.js";
import type { Prisma, PrismaClient } from "./client.js";
import type { ComputerMode } from "./computers.js";
import { ensureComputerRecord, parseComputerMode, teamComputerUserId } from "./computers.js";
import { createThreadMessageInTransaction } from "./messages.js";
import { withNewestThreadMessages } from "./preview-messages.js";
import { IsolationError } from "./scope.js";
import { lockSpaceForContentCreation } from "./spaces.js";
import {
  activeRunSelection,
  previewFromBlocks,
  primaryActiveRun,
  threadRunStatus,
  withLatestBotRuns,
} from "./thread-listing.js";
import { withTransactionRetry } from "./transaction-retry.js";

/** Newest messages loaded for sidebar preview; enough to skip a short peer-run tail. */
const SIDEBAR_PREVIEW_MESSAGE_WINDOW = 16;

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

function rosterRunErrorId(
  latestRun: { id: string; status: string } | undefined,
  activeRun: { status: string } | undefined,
): string | null {
  if (
    latestRun?.status !== "failed" ||
    activeRun?.status === "waiting_input" ||
    activeRun?.status === "waiting_takeover"
  ) {
    return null;
  }
  return latestRun.id;
}

// Roster rows show when the chat last moved. Bot.updatedAt also moves on settings writes,
// so the newest message's time wins when the chat has one.
function rosterUpdatedAt(newestMessage: { createdAt: Date } | undefined, botUpdatedAt: Date) {
  return newestMessage?.createdAt ?? botUpdatedAt;
}

function mapBot(
  bot: {
    id: string;
    spaceId: string;
    name: string;
    instructions: string;
    instructionHistory?: unknown;
    color: string;
    notifyOnFinish: boolean;
    archivedAt: Date | null;
    memoryScope: string | null;
    createdAt: Date;
    updatedAt: Date;
    thread: { id: string; unread: boolean } | null;
    computer: { scope: string } | null;
    voiceId?: string | null;
    autoSpeak?: boolean;
    modelProvider?: string | null;
    modelId?: string | null;
    thinkingLevel?: string | null;
    teamChatAmbientEnabled?: boolean;
    teamChatRules?: string;
    disabledBuiltinTools?: string[];
    webhookSecretId?: string | null;
  },
  preview = "",
  status = "idle",
  runErrorId: string | null = null,
  updatedAt: Date = bot.updatedAt,
): Bot {
  if (!bot.thread) {
    throw new IsolationError("Bot is missing its thread");
  }
  return {
    id: bot.id,
    spaceId: bot.spaceId,
    name: bot.name,
    title: "",
    instructions: bot.instructions,
    instructionHistory: InstructionVersionSchema.array().parse(bot.instructionHistory ?? []),
    color: bot.color,
    notifyOnFinish: bot.notifyOnFinish,
    archivedAt: bot.archivedAt?.toISOString() ?? null,
    unread: bot.thread.unread,
    memoryScope: bot.memoryScope as "isolated" | "shared" | null,
    threadId: bot.thread.id,
    preview,
    status,
    runErrorId,
    computerMode: bot.computer ? parseComputerMode(bot.computer.scope) : "team",
    createdAt: bot.createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
    voiceId: bot.voiceId ?? null,
    autoSpeak: bot.autoSpeak ?? false,
    modelProvider: bot.modelProvider ? canonicalPiProviderId(bot.modelProvider) : null,
    modelId: bot.modelId ?? null,
    thinkingLevel: (bot.thinkingLevel as Bot["thinkingLevel"]) ?? null,
    teamChatAmbientEnabled: bot.teamChatAmbientEnabled ?? false,
    teamChatRules: bot.teamChatRules ?? "",
    // Stored lists may name a tool that no longer exists; settings resend what they read.
    disabledBuiltinTools: [...disabledBuiltinToolSet(bot.disabledBuiltinTools)],
    webhookConfigured: Boolean(bot.webhookSecretId),
  };
}

export function createRepos(prisma: PrismaClient) {
  async function listSpaceBotsForSpaces(spaceIds: string[]): Promise<SpaceBot[]> {
    if (spaceIds.length === 0) return [];
    const rows = await prisma.bot.findMany({
      where: {
        spaceId: { in: spaceIds },
        archivedAt: null,
      },
      select: {
        id: true,
        spaceId: true,
        name: true,
        color: true,
        notifyOnFinish: true,
        updatedAt: true,
        thread: {
          select: {
            id: true,
            unread: true,
          },
        },
        runs: activeRunSelection,
      },
      orderBy: { createdAt: "asc" },
    });
    const bots = await withNewestThreadMessages(prisma, await withLatestBotRuns(prisma, rows), 1);
    return bots.map((bot) => {
      if (!bot.thread) throw new IsolationError("Bot is missing its thread");
      const activeRun = primaryActiveRun(bot.runs);
      return {
        id: bot.id,
        spaceId: bot.spaceId,
        name: bot.name,
        title: "",
        color: bot.color,
        notifyOnFinish: bot.notifyOnFinish,
        unread: bot.thread.unread,
        preview: previewFromBlocks(bot.thread.messages[0]?.blocks),
        status: activeRun?.status ?? "idle",
        threadStatus: threadRunStatus(bot.runs, bot.thread.id),
        runErrorId: rosterRunErrorId(bot.thread.runs[0], activeRun),
        updatedAt: rosterUpdatedAt(bot.thread.messages[0], bot.updatedAt).toISOString(),
      };
    });
  }

  return {
    async listBots(actor: Actor): Promise<Bot[]> {
      const bots = await withNewestThreadMessages(
        prisma,
        await withLatestBotRuns(
          prisma,
          await prisma.bot.findMany({
            where: {
              spaceId: actor.spaceId,
              archivedAt: null,
            },
            include: {
              thread: true,
              runs: activeRunSelection,
              computer: { select: { scope: true } },
            },
            orderBy: { createdAt: "asc" },
          }),
        ),
        SIDEBAR_PREVIEW_MESSAGE_WINDOW,
      );
      const candidateRunIds = [
        ...new Set(
          bots.flatMap((bot) =>
            (bot.thread?.messages ?? []).flatMap((message) =>
              message.runId ? [message.runId] : [],
            ),
          ),
        ),
      ];
      const checkedRunIds = new Set<string>();
      const backgroundRunIds = new Set<string>();
      const classifyRunIds = async (ids: string[]) => {
        const missing = ids.filter((id) => !checkedRunIds.has(id));
        if (missing.length === 0) return;
        const rows = await prisma.run.findMany({
          where: {
            id: { in: missing },
            trigger: { in: [...BACKGROUND_RUN_TRIGGERS] },
          },
          select: { id: true },
        });
        for (const row of rows) backgroundRunIds.add(row.id);
        for (const id of missing) checkedRunIds.add(id);
      };
      await classifyRunIds(candidateRunIds);
      return Promise.all(
        bots.map(async (bot) => {
          let messages = bot.thread?.messages ?? [];
          const updatedAt = rosterUpdatedAt(messages[0], bot.updatedAt);
          let preview = "";
          for (let attempt = 0; attempt < 5; attempt++) {
            const windowRunIds = [
              ...new Set(messages.flatMap((message) => (message.runId ? [message.runId] : []))),
            ].filter((runId) => !checkedRunIds.has(runId));
            if (windowRunIds.length > 0) {
              await classifyRunIds(windowRunIds);
            }
            const visible = userVisibleMessages(
              messages.map((message) => ({
                ...message,
                blocks: message.blocks as MessageBlock[],
                runId: message.runId ?? undefined,
              })),
              { backgroundRunIds },
            );
            for (const message of visible) {
              preview = previewFromBlocks(message.blocks);
              if (preview) break;
            }
            if (preview || messages.length === 0 || !bot.thread || attempt === 4) break;
            const oldest = messages[messages.length - 1];
            if (!oldest) break;
            messages = await prisma.message.findMany({
              where: { threadId: bot.thread.id, seq: { lt: oldest.seq } },
              orderBy: { seq: "desc" },
              take: SIDEBAR_PREVIEW_MESSAGE_WINDOW,
            });
            if (messages.length === 0) break;
          }
          const activeRun = primaryActiveRun(bot.runs);
          const mapped = mapBot(
            bot,
            preview,
            activeRun?.status ?? "idle",
            rosterRunErrorId(bot.thread?.runs[0], activeRun),
            updatedAt,
          );
          return { ...mapped, threadStatus: threadRunStatus(bot.runs, mapped.threadId) };
        }),
      );
    },

    listSpaceBotsForSpaces,

    async getBot(actor: Actor, botId: string, options: { includeArchived?: boolean } = {}) {
      const bot = await prisma.bot.findFirst({
        where: {
          id: botId,
          spaceId: actor.spaceId,
          ...(options.includeArchived ? {} : { archivedAt: null }),
        },
        include: { thread: true, computer: true },
      });
      if (!bot) throw new IsolationError();
      return bot;
    },

    async createBot(
      actor: Actor,
      input: {
        id?: string;
        name: string;
        instructions: string;
        notifyOnFinish: boolean;
        color?: string;
        avatarFamily?: number;
        computerMode?: ComputerMode;
        modelProvider?: string | null;
        modelId?: string | null;
        thinkingLevel?: string | null;
        disabledBuiltinTools?: string[];
        initialMessage?: {
          role: "user" | "bot" | "system";
          blocks: MessageBlock[];
          runId?: string;
        };
        /** Adds content in the creation transaction, after the bot and its MEMORY.md exist. */
        seed?: (tx: Prisma.TransactionClient, botId: string) => Promise<void>;
        isolationLevel?: Prisma.TransactionIsolationLevel;
      },
    ): Promise<Bot> {
      const modelProvider = input.modelProvider ?? null;
      const modelId = input.modelId ?? null;
      const thinkingLevel = input.thinkingLevel ?? null;
      const disabledBuiltinTools = input.disabledBuiltinTools ?? [];
      const settings = await prisma.deploymentSettings.findUnique({ where: { id: "default" } });
      const envKind = process.env.SANDBOX_PROVIDER ?? "docker";
      const kind =
        envKind === "docker" && settings?.computerHost === "this-mac" ? "desktop" : envKind;
      const inTransaction = <T>(run: (tx: Prisma.TransactionClient) => Promise<T>) =>
        input.isolationLevel
          ? prisma.$transaction(run, { isolationLevel: input.isolationLevel })
          : prisma.$transaction(run);
      const insertBot = () =>
        inTransaction(async (tx) => {
          await lockSpaceForContentCreation(tx, {
            spaceId: actor.spaceId,
            userId: actor.userId,
          });
          const avatar = chooseBotAvatar(
            await tx.bot.findMany({
              where: { spaceId: actor.spaceId, archivedAt: null },
              select: { id: true, color: true },
            }),
            input.color,
            { family: input.avatarFamily, id: input.id },
          );
          const teamComputer = await ensureComputerRecord(tx, {
            mode: "team",
            spaceId: actor.spaceId,
            userId: await teamComputerUserId(tx, actor),
            kind,
          });
          const created = await tx.bot.create({
            data: {
              id: avatar.id,
              spaceId: actor.spaceId,
              userId: actor.userId,
              name: displayName(input.name, ""),
              instructions: input.instructions,
              notifyOnFinish: input.notifyOnFinish,
              color: avatar.color,
              computerId: teamComputer.id,
              modelProvider,
              modelId,
              thinkingLevel,
              disabledBuiltinTools,
            },
          });
          const thread = await tx.thread.create({
            data: {
              spaceId: actor.spaceId,
              botId: created.id,
              userId: actor.userId,
            },
          });
          if (input.initialMessage) {
            await createThreadMessageInTransaction(tx, {
              threadId: thread.id,
              ...input.initialMessage,
              markUnread: false,
            });
          }
          if (input.computerMode === "dedicated") {
            const dedicated = await ensureComputerRecord(tx, {
              mode: "dedicated",
              spaceId: actor.spaceId,
              userId: actor.userId,
              botId: created.id,
              kind,
            });
            await tx.bot.update({ where: { id: created.id }, data: { computerId: dedicated.id } });
          }
          await tx.browserProfile.create({
            data: {
              spaceId: actor.spaceId,
              botId: created.id,
              userId: actor.userId,
            },
          });
          await tx.memoryDocument.create({
            data: {
              spaceId: actor.spaceId,
              userId: actor.userId,
              botId: created.id,
              scope: "bot",
              path: "MEMORY.md",
              content: initialBotMemory(input.name),
            },
          });
          await input.seed?.(tx, created.id);
          return tx.bot.findFirstOrThrow({
            where: { id: created.id },
            include: { thread: true, computer: true },
          });
        });

      let bot: Awaited<ReturnType<typeof insertBot>>;
      try {
        bot = await insertBot();
      } catch (error) {
        // A reserved preview identity is an idempotency key if the response is lost.
        if (!input.id || !isUniqueViolation(error)) throw error;
        const existing = await prisma.bot.findFirst({
          where: { id: input.id, spaceId: actor.spaceId, archivedAt: null },
          include: { thread: true, computer: true },
        });
        if (!existing) throw error;
        bot = existing;
      }
      return mapBot(bot);
    },

    async setBotComputer(actor: Actor, botId: string, mode: ComputerMode): Promise<Bot> {
      const bot = await prisma.bot.findFirst({
        where: { id: botId, spaceId: actor.spaceId },
        include: { computer: true },
      });
      if (!bot?.computer) throw new IsolationError();
      const kind = bot.computer.kind;
      // Keep ensure + bot link in one transaction so a capped quota lock covers
      // both steps (a computer row alone does not count until a live bot refs it).
      // A private computer stays with the bot's creator, whoever in the space changes the mode;
      // the team one is the Space's.
      const updated = await withTransactionRetry(() =>
        prisma.$transaction(async (tx) => {
          const computer = await ensureComputerRecord(tx, {
            mode,
            spaceId: actor.spaceId,
            userId:
              mode === "team"
                ? await teamComputerUserId(tx, { spaceId: actor.spaceId, userId: bot.userId })
                : bot.userId,
            botId,
            kind,
          });
          return tx.bot.update({
            where: { id: botId },
            data: { computerId: computer.id },
            include: { thread: true, computer: true },
          });
        }),
      );
      return mapBot(updated);
    },
  };
}
