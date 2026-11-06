import type { Actor, MessageBlock } from "@labradoodle/contracts";
import { QUEUE_HOLDING_RUN_STATUSES } from "@labradoodle/core";
import type { Prisma, PrismaClient, ThreadEvents } from "@labradoodle/db";
import { appendEventInTransaction, requireChatMember, withTransactionRetry } from "@labradoodle/db";

export type McpApprovalDeps = {
  prisma: PrismaClient;
  events: ThreadEvents;
};

export type McpApprovalResolution = {
  /** The workspace's Doodle, which posted the card. */
  botId: string;
  serverId: string;
  status: "connected" | "dismissed";
  /** The chat whose cards should resolve. */
  threadId: string;
};

export type McpApprovalDecision = {
  /** Whether this decision may turn the server on. */
  connect: boolean;
  /** Whether it closed an open card, rather than repeating a decision. */
  resolved: boolean;
};

export type ThreadSeq = {
  threadId: string;
  seq: number;
};

type ApprovalBlock = Extract<MessageBlock, { kind: "mcp_approval" }>;

function isApproval(block: MessageBlock, serverId: string): block is ApprovalBlock {
  return block.kind === "mcp_approval" && block.serverId === serverId;
}

function isOpen(block: ApprovalBlock): boolean {
  return block.status !== "connected" && block.status !== "dismissed";
}

async function threadsForDecision(
  deps: McpApprovalDeps,
  actor: Actor,
  input: McpApprovalResolution,
): Promise<ApprovalThread[]> {
  // A chat's cards are seen by everyone in it, but a card is about one person's own server:
  // only that person resolves it.
  const server = await deps.prisma.mcpServer.findFirst({
    where: { id: input.serverId, userId: actor.userId },
    select: { id: true },
  });
  if (!server) return [];
  const chat = await requireChatMember(deps.prisma, actor, input.threadId);
  return [{ id: chat.id }];
}

type ApprovalThread = { id: string };

async function rewriteCards(
  tx: Prisma.TransactionClient,
  actor: Actor,
  threads: ApprovalThread[],
  input: { botId?: string; serverId: string; status: ApprovalBlock["status"] },
  selectable: (block: ApprovalBlock) => boolean,
): Promise<{ seqs: ThreadSeq[]; flipped: number; dismissed: boolean; connected: boolean }> {
  const seqs: ThreadSeq[] = [];
  let flipped = 0;
  let dismissed = false;
  let connected = false;
  for (const thread of threads) {
    const messages = await tx.message.findMany({
      where: { threadId: thread.id },
      select: { id: true, botId: true, blocks: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    for (const message of messages) {
      if (message.botId && message.botId !== input.botId) continue;
      const blocks = message.blocks as MessageBlock[];
      const matching = blocks.filter((block): block is ApprovalBlock =>
        isApproval(block, input.serverId),
      );
      if (matching.length === 0) continue;
      for (const block of matching) {
        if (block.status === "dismissed") dismissed = true;
        else if (block.status === "connected") connected = true;
      }
      if (!matching.some(selectable)) continue;
      const next = blocks.map((block) =>
        isApproval(block, input.serverId) && selectable(block)
          ? { ...block, status: input.status }
          : block,
      );
      await tx.message.update({ where: { id: message.id }, data: { blocks: next } });
      flipped += 1;
      const event = await appendEventInTransaction(tx, {
        spaceId: actor.spaceId,
        threadId: thread.id,
        botId: message.botId ?? input.botId,
        type: "thread.message.updated",
        payload: { messageId: message.id, role: "bot", blocks: next },
      });
      seqs.push({ threadId: thread.id, seq: event.seq });
    }
  }
  return { seqs, flipped, dismissed, connected };
}

/** Flip every open mcp_approval card for this server. The read, the writes,
    and `effect` share one serializable transaction. A card decision (one that
    passes threadId) sees `connect: false` when a dismissal already won, so that
    race does not turn the server on. Settings approval omits threadId and
    still connects. */
export async function resolveMcpApprovalCards<T>(
  deps: McpApprovalDeps,
  actor: Actor,
  input: McpApprovalResolution,
  effect?: (tx: Prisma.TransactionClient, decision: McpApprovalDecision) => Promise<T>,
): Promise<T | undefined> {
  const threads = await threadsForDecision(deps, actor, input);
  const committed = await withTransactionRetry(() =>
    deps.prisma.$transaction(
      async (tx) => {
        const selectable =
          input.threadId === undefined
            ? (block: ApprovalBlock) => block.status !== "connected"
            : isOpen;
        const painted = await rewriteCards(tx, actor, threads, input, selectable);
        const dismissalWon =
          input.threadId !== undefined &&
          painted.flipped === 0 &&
          !painted.connected &&
          painted.dismissed;
        const connect = !dismissalWon;
        const resolved = painted.flipped > 0;
        const value = effect ? await effect(tx, { connect, resolved }) : undefined;
        return { seqs: painted.seqs, value };
      },
      { isolationLevel: "Serializable" },
    ),
  );
  for (const event of committed.seqs) await deps.events.notify(event.threadId, event.seq);
  return committed.value;
}

async function closeServerCards(
  client: Prisma.TransactionClient,
  actor: Actor,
  serverId: string,
): Promise<ThreadSeq[]> {
  const messages = await client.message.findMany({
    where: {
      thread: { spaceId: actor.spaceId },
      blocks: { array_contains: [{ kind: "mcp_approval", serverId }] },
    },
    select: { id: true, botId: true, blocks: true, threadId: true },
  });
  const seqs: ThreadSeq[] = [];
  for (const message of messages) {
    const blocks = message.blocks as MessageBlock[];
    if (!blocks.some((block) => isApproval(block, serverId) && block.status !== "dismissed")) {
      continue;
    }
    const next = blocks.map((block) =>
      isApproval(block, serverId) && block.status !== "dismissed"
        ? { ...block, status: "dismissed" as const }
        : block,
    );
    await client.message.update({ where: { id: message.id }, data: { blocks: next } });
    const event = await appendEventInTransaction(client, {
      spaceId: actor.spaceId,
      threadId: message.threadId,
      ...(message.botId ? { botId: message.botId } : {}),
      type: "thread.message.updated",
      payload: { messageId: message.id, role: "bot", blocks: next },
    });
    seqs.push({ threadId: message.threadId, seq: event.seq });
  }
  return seqs;
}

/** Deleting a server closes every approval card for it, including cards that
    were never connected. */
export async function dismissMcpServerApprovals(
  deps: McpApprovalDeps,
  actor: Actor,
  serverId: string,
  tx?: Prisma.TransactionClient,
): Promise<ThreadSeq[]> {
  if (tx) return closeServerCards(tx, actor, serverId);
  const seqs = await withTransactionRetry(() =>
    deps.prisma.$transaction((client) => closeServerCards(client, actor, serverId), {
      isolationLevel: "Serializable",
    }),
  );
  for (const event of seqs) await deps.events.notify(event.threadId, event.seq);
  return seqs;
}

function mcpConnectedPrompt(name: string): string {
  return `The user just connected the MCP server ${JSON.stringify(name)} from its approval card, so its tools are available now. Carry on with what they asked for. If nothing is left to do, confirm in one short sentence.`;
}

/** Approving a card in a chat is the person's turn: queue a hidden-prompt run so Doodle carries
    on with the server's tools instead of waiting for another message. Skipped while Doodle is
    busy in that chat or no longer in it. Returns the run to enqueue. */
export async function queueMcpConnectedRun(
  tx: Prisma.TransactionClient,
  actor: Actor,
  input: { botId: string; serverId: string; threadId: string },
): Promise<string | null> {
  const thread = await tx.thread.findFirst({
    where: {
      id: input.threadId,
      spaceId: actor.spaceId,
      doodle: true,
      members: { some: { userId: actor.userId } },
    },
    select: { id: true },
  });
  if (!thread) return null;
  const [bot, busy, server] = await Promise.all([
    tx.bot.findFirst({
      where: { id: input.botId, spaceId: actor.spaceId },
      select: { id: true },
    }),
    tx.run.findFirst({
      where: {
        threadId: thread.id,
        botId: input.botId,
        status: { in: [...QUEUE_HOLDING_RUN_STATUSES] },
      },
      select: { id: true },
    }),
    tx.mcpServer.findFirst({
      where: { id: input.serverId, userId: actor.userId },
      select: { name: true },
    }),
  ]);
  if (!bot || busy || !server) return null;
  const task = await tx.task.create({
    data: {
      spaceId: actor.spaceId,
      botId: input.botId,
      threadId: thread.id,
      userId: actor.userId,
      prompt: mcpConnectedPrompt(server.name),
      status: "queued",
    },
  });
  const run = await tx.run.create({
    data: {
      spaceId: actor.spaceId,
      botId: input.botId,
      threadId: thread.id,
      taskId: task.id,
      userId: actor.userId,
      status: "queued",
      trigger: "user",
    },
    select: { id: true },
  });
  return run.id;
}
