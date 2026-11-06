import type { JobPublisher } from "@labradoodle/adapter-kit";
import { runContinueJob } from "@labradoodle/adapter-kit";
import type { ConnectorRegistry } from "@labradoodle/adapters";
import type { Actor, MessageBlock } from "@labradoodle/contracts";
import {
  appConnectCard,
  connectedAppBlocks,
  matchAppCatalog,
  matchesAppConnection,
} from "@labradoodle/core";
import type { Prisma, PrismaClient, ThreadEvents } from "@labradoodle/db";
import {
  appendEventInTransaction,
  createThreadMessageInTransaction,
  THREAD_LOCK_TRANSACTION_OPTIONS,
} from "@labradoodle/db";
import { getLogger } from "@labradoodle/logging";
import { requireChatDoodle } from "./bot-thread.js";
import { resolveChatTarget } from "./thread-target.js";

type OnboardingDeps = {
  prisma: PrismaClient;
  events: ThreadEvents;
  connectors: ConnectorRegistry;
};

const WELCOME_TEXT =
  "Welcome to Labradoodle, let's get you started, to get the most out of the app, please connect your tools";

const WELCOME_APPS = ["slack", "gmail", "googlecalendar", "hackernews", "notion", "googledocs"];

/** Seeds the person's first chat with a welcome and app cards, once, before they write. */
export async function welcome(deps: OnboardingDeps, actor: Actor, threadId: string): Promise<void> {
  const { bot, thread } = await requireChatDoodle(deps, actor, threadId);
  const catalog = (
    await Promise.all(
      deps.connectors.managedProviders().map((provider) =>
        provider
          .catalog({
            operationId: "onboarding.welcome",
            traceId: "onboarding.welcome",
            spaceId: actor.spaceId,
            userId: actor.userId,
            botId: bot.id,
            signal: AbortSignal.timeout(15_000),
          })
          .catch(() => []),
      ),
    )
  ).flat();
  const cards = WELCOME_APPS.flatMap((slug) => {
    const entry = matchAppCatalog(catalog, slug);
    return entry ? [appConnectCard(entry)] : [];
  });
  const posts: MessageBlock[][] = [[{ kind: "text", text: WELCOME_TEXT }]];
  if (cards.length) posts.push(cards);
  const committed = await deps.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT id FROM threads WHERE id = ${thread.id} FOR UPDATE`;
    const recent = await tx.message.findMany({
      where: { threadId: thread.id },
      select: { role: true, blocks: true },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
    if (
      recent.some(
        (message) =>
          message.role === "user" ||
          (message.blocks as MessageBlock[]).some(
            (block) =>
              block.kind === "ask" || (block.kind === "text" && block.text === WELCOME_TEXT),
          ),
      )
    )
      return [];
    const events = [];
    for (const blocks of posts) {
      const message = await createThreadMessageInTransaction(tx, {
        threadId: thread.id,
        role: "bot",
        markUnread: false,
        blocks,
      });
      events.push(
        await appendEventInTransaction(tx, {
          spaceId: actor.spaceId,
          threadId: thread.id,
          botId: bot.id,
          type: "thread.message.created",
          payload: { messageId: message.id, role: "bot", blocks },
        }),
      );
    }
    return events;
  }, THREAD_LOCK_TRANSACTION_OPTIONS);
  for (const event of committed) await deps.events.notify(thread.id, event.seq);
}

/**
 * Flips the chat's cards for an app the person just connected, and once per app per chat
 * tells Doodle with a "<App> connected" line it answers as the person's turn.
 */
export async function markAppConnected(
  deps: OnboardingDeps & { jobs: Pick<JobPublisher, "enqueue"> },
  actor: Actor,
  input: {
    threadId: string;
    provider: string;
    connectorId?: string;
    messageId?: string;
    admitDoodle: (doodleId: string) => Promise<boolean>;
  },
): Promise<void> {
  const { provider, connectorId = "composio", messageId } = input;
  const target = await resolveChatTarget(deps.prisma, actor, input);
  const botId = target.doodleId;
  const threadId = target.threadId;
  const providerAdapter = deps.connectors.managed(connectorId);
  if (!providerAdapter) return;
  const catalog = await providerAdapter.catalog(
    {
      operationId: "onboarding.appConnected",
      traceId: "onboarding.appConnected",
      spaceId: actor.spaceId,
      userId: actor.userId,
      botId,
      signal: AbortSignal.timeout(15_000),
    },
    provider,
  );
  const entry = matchAppCatalog(
    catalog.filter((item) => item.connectorId === connectorId),
    provider,
  );
  if (!entry) return;
  // The provider lists only authorized apps as connected; a no-auth app is the person's saved one.
  const connected =
    entry.connected ||
    (entry.noAuth &&
      (await deps.prisma.connection.count({
        where: {
          userId: actor.userId,
          spaceId: actor.spaceId,
          connectorId,
          provider: { equals: entry.slug, mode: "insensitive" },
          status: "connected",
        },
      })) > 0);
  if (!connected) return;
  const cardTarget = { spaceId: actor.spaceId, botId, threadId };
  const updates = await deps.prisma.$transaction(async (tx) => {
    // Two authorizations may finish together on an onboarding message with multiple cards.
    await tx.$executeRaw`SELECT id FROM threads WHERE id = ${threadId} FOR UPDATE`;
    // Onboarding cards sit at the start of the chat and inline cards near the end;
    // bound both reads so a long chat is never scanned in full.
    const select = { id: true, blocks: true } as const;
    const first = await tx.message.findMany({
      where: { threadId },
      select,
      orderBy: { createdAt: "asc" },
      take: 100,
    });
    const latest = await tx.message.findMany({
      where: { threadId },
      select,
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    const own = messageId
      ? await tx.message.findMany({ where: { id: messageId, threadId }, select })
      : [];
    const messages = [...new Map([...first, ...latest, ...own].map((m) => [m.id, m])).values()];
    const events = [];
    for (const message of messages) {
      const blocks = message.blocks as MessageBlock[];
      if (
        !blocks.some(
          (block) =>
            matchesAppConnection(block, connectorId, entry.slug) && block.status !== "connected",
        )
      )
        continue;
      const next = connectedAppBlocks(blocks, connectorId, entry.slug);
      await tx.message.update({ where: { id: message.id }, data: { blocks: next } });
      events.push(
        await appendEventInTransaction(tx, {
          ...cardTarget,
          type: "thread.message.updated",
          payload: { messageId: message.id, role: "bot", blocks: next },
        }),
      );
    }
    return events;
  }, THREAD_LOCK_TRANSACTION_OPTIONS);
  for (const event of updates) await deps.events.notify(threadId, event.seq);
  if (!target.doodle || !(await input.admitDoodle(botId).catch(() => false))) return;
  const text = `${entry.name} connected`;
  const sent = await deps.events.sendUserMessage({
    spaceId: actor.spaceId,
    threadId,
    botId,
    userId: actor.userId,
    role: "system",
    blocks: [{ kind: "meta", text }],
    prompt: text,
    trigger: "follow_up",
    clientNonce: `app-connected:${connectorId}:${entry.slug}`,
  });
  if (!sent.taskId || !sent.runId) return;
  // The queued run is durable; a missed wake is repaired by the reconciler.
  await deps.jobs.enqueue(runContinueJob(sent.runId)).catch((error) => {
    getLogger().error("app connected enqueue", error);
  });
}
