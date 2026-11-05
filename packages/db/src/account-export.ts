import type { AccountExportManifest, AccountExportRecord } from "@labradoodle/contracts";
import type { Prisma, PrismaClient } from "./client.js";
import { runAsTenant } from "./row-security.js";

const PAGE = 200;

type Tenant = { spaceId: string; userId: string };

export interface AccountExportSpace {
  id: string;
  /** In time order, parents before children, as the archive format requires. */
  records(): AsyncGenerator<AccountExportRecord>;
  /**
   * Every artifact in `records()`, with where its bytes are stored. Read after `records()`, from
   * what it wrote, so a file saved meanwhile cannot appear without its record.
   */
  artifacts(): AsyncGenerator<{ id: string; storageKey: string }>;
  /** Bots in `records()` that have a computer, whose workspace files go in the archive. */
  homes(): Promise<Array<{ botId: string; homeKey: string; computerScope: string }>>;
}

export interface AccountExportSource {
  userId: string;
  user: AccountExportManifest["user"];
  spaces: Array<AccountExportManifest["spaces"][number] & AccountExportSpace>;
}

/**
 * Pulls `generator` one step at a time inside the tenant's database context, so it can be
 * consumed lazily from code that runs outside it, like a response stream's pull.
 */
export async function* runGeneratorAsTenant<T>(
  tenant: Tenant,
  generator: AsyncGenerator<T>,
): AsyncGenerator<T> {
  try {
    for (;;) {
      const step = await runAsTenant(tenant, () => generator.next());
      if (step.done) return;
      yield step.value;
    }
  } finally {
    await runAsTenant(tenant, () => generator.return(undefined));
  }
}

/**
 * Everything a user can take to another install, read through the encrypting client so content
 * is decrypted. Each space is read in its own tenant context, and user-owned rows are also
 * filtered by user explicitly, since the database login may not enforce row-level security.
 */
export async function readAccountExport(
  prisma: PrismaClient,
  userId: string,
): Promise<AccountExportSource> {
  const [user, memberships] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { name: true, email: true, timezone: true },
    }),
    prisma.spaceMember.findMany({
      where: { userId, space: { deletingAt: null } },
      orderBy: [{ space: { createdAt: "asc" } }, { spaceId: "asc" }],
      select: { space: { select: { id: true, name: true, createdAt: true } } },
    }),
  ]);
  return {
    userId,
    user,
    spaces: memberships.map(({ space }) => {
      const tenant = { spaceId: space.id, userId };
      const written: Written = { artifacts: [], botIds: [] };
      return {
        id: space.id,
        name: space.name,
        createdAt: space.createdAt.toISOString(),
        records: () => runGeneratorAsTenant(tenant, spaceRecords(prisma, tenant, written)),
        artifacts: async function* () {
          yield* written.artifacts;
        },
        homes: () =>
          runAsTenant(tenant, async () => {
            const bots = await prisma.bot.findMany({
              where: { ...tenant, id: { in: written.botIds }, computerId: { not: null } },
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
              select: { id: true, computer: { select: { homeKey: true, scope: true } } },
            });
            return bots.flatMap((bot) =>
              bot.computer
                ? [
                    {
                      botId: bot.id,
                      homeKey: bot.computer.homeKey,
                      computerScope: bot.computer.scope,
                    },
                  ]
                : [],
            );
          }),
      };
    }),
  };
}

type Written = { artifacts: Array<{ id: string; storageKey: string }>; botIds: string[] };

type Json = Extract<AccountExportRecord, { type: "message" }>["blocks"];
// Prisma's and zod's JSON types describe the same values but don't line up in TypeScript.
const json = (value: Prisma.JsonValue) => value as Json;
const iso = (date: Date) => date.toISOString();
const isoOrNull = (date: Date | null) => date?.toISOString() ?? null;

async function* spaceRecords(
  prisma: PrismaClient,
  tenant: Tenant,
  written: Written,
): AsyncGenerator<AccountExportRecord> {
  const bots = await prisma.bot.findMany({
    where: tenant,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const botIds = new Set(bots.map((bot) => bot.id));
  written.botIds.push(...botIds);
  const ownBot = (id: string | null) => (id && botIds.has(id) ? id : null);
  for (const bot of bots)
    yield {
      type: "bot",
      id: bot.id,
      name: bot.name,
      instructions: bot.instructions,
      color: bot.color,
      notifyOnFinish: bot.notifyOnFinish,
      archivedAt: isoOrNull(bot.archivedAt),
      memoryScope: bot.memoryScope,
      voiceId: bot.voiceId,
      autoSpeak: bot.autoSpeak,
      modelProvider: bot.modelProvider,
      modelId: bot.modelId,
      thinkingLevel: bot.thinkingLevel,
      disabledBuiltinTools: bot.disabledBuiltinTools,
      teamChatAmbientEnabled: bot.teamChatAmbientEnabled,
      teamChatRules: bot.teamChatRules,
      createdAt: iso(bot.createdAt),
    };

  const groups = await prisma.chatGroup.findMany({
    where: tenant,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
  });
  const groupIds = new Set(groups.map((group) => group.id));
  const ownGroup = (id: string | null) => (id && groupIds.has(id) ? id : null);
  for (const group of groups)
    yield {
      type: "chat_group",
      id: group.id,
      name: group.name,
      archivedAt: isoOrNull(group.archivedAt),
      botIds: group.members.flatMap((member) => (botIds.has(member.botId) ? [member.botId] : [])),
      createdAt: iso(group.createdAt),
    };

  for (let cursor = ""; ; ) {
    const pages = await prisma.page.findMany({
      where: { ...tenant, id: { gt: cursor } },
      orderBy: { id: "asc" },
      take: PAGE,
    });
    for (const page of pages) {
      yield {
        type: "page",
        id: page.id,
        botId: ownBot(page.botId),
        groupId: ownGroup(page.groupId),
        title: page.title,
        pinnedAt: isoOrNull(page.pinnedAt),
        currentVersion: page.currentVersion,
        createdAt: iso(page.createdAt),
        updatedAt: iso(page.updatedAt),
      };
      // A save landing after the page row was read stays out, so the archive matches its header.
      for (let version = 0; ; ) {
        const versions = await prisma.pageVersion.findMany({
          where: { pageId: page.id, version: { gt: version, lte: page.currentVersion } },
          orderBy: { version: "asc" },
          take: PAGE,
          select: { id: true, version: true, title: true, source: true, createdAt: true },
        });
        for (const row of versions)
          yield { type: "page_version", ...row, pageId: page.id, createdAt: iso(row.createdAt) };
        if (versions.length < PAGE) break;
        version = versions.at(-1)!.version;
      }
    }
    if (pages.length < PAGE) break;
    cursor = pages.at(-1)!.id;
  }

  const threadIds = new Set<string>();
  const ownThread = (id: string | null) => (id && threadIds.has(id) ? id : null);
  for (let cursor = ""; ; ) {
    const threads = await prisma.thread.findMany({
      where: {
        ...tenant,
        id: { gt: cursor },
        externalConversationId: null,
        OR: [{ botId: { in: [...botIds] } }, { groupId: { in: [...groupIds] } }],
      },
      orderBy: { id: "asc" },
      take: PAGE,
      select: {
        id: true,
        botId: true,
        groupId: true,
        historyCompactedUpToSeq: true,
        historyCompactionSummary: true,
        createdAt: true,
      },
    });
    for (const thread of threads) {
      threadIds.add(thread.id);
      yield { type: "thread", ...thread, createdAt: iso(thread.createdAt) };
      for (let seq = -1; ; ) {
        const messages = await prisma.message.findMany({
          where: { threadId: thread.id, seq: { gt: seq } },
          orderBy: { seq: "asc" },
          take: PAGE,
          select: {
            id: true,
            seq: true,
            role: true,
            blocks: true,
            botId: true,
            replyToMessageId: true,
            replyQuote: true,
            createdAt: true,
          },
        });
        for (const message of messages)
          yield {
            type: "message",
            ...message,
            blocks: json(message.blocks),
            threadId: thread.id,
            botId: ownBot(message.botId),
            createdAt: iso(message.createdAt),
          };
        if (messages.length < PAGE) break;
        seq = messages.at(-1)!.seq;
      }
    }
    if (threads.length < PAGE) break;
    cursor = threads.at(-1)!.id;
  }

  const artifactRecord = (row: {
    id: string;
    botId: string | null;
    groupId: string | null;
    name: string;
    description: string | null;
    mimeType: string;
    size: number;
    hash: string;
    rootArtifactId: string | null;
    version: number;
    storageKey: string;
    createdAt: Date;
  }): AccountExportRecord => {
    written.artifacts.push({ id: row.id, storageKey: row.storageKey });
    return {
      type: "artifact",
      id: row.id,
      botId: ownBot(row.botId),
      groupId: ownGroup(row.groupId),
      name: row.name,
      description: row.description,
      mimeType: row.mimeType,
      size: row.size,
      hash: row.hash,
      rootArtifactId: row.rootArtifactId,
      version: row.version,
      createdAt: iso(row.createdAt),
    };
  };
  for (let cursor = ""; ; ) {
    const roots = await prisma.artifact.findMany({
      where: { ...tenant, id: { gt: cursor }, rootArtifactId: null },
      orderBy: { id: "asc" },
      take: PAGE,
    });
    for (const root of roots) {
      yield artifactRecord(root);
      for (let version = 0; ; ) {
        const versions = await prisma.artifact.findMany({
          where: { ...tenant, rootArtifactId: root.id, version: { gt: version } },
          orderBy: { version: "asc" },
          take: PAGE,
        });
        for (const row of versions) yield artifactRecord(row);
        if (versions.length < PAGE) break;
        version = versions.at(-1)!.version;
      }
    }
    if (roots.length < PAGE) break;
    cursor = roots.at(-1)!.id;
  }

  for (let cursor = ""; ; ) {
    const documents = await prisma.memoryDocument.findMany({
      where: {
        ...tenant,
        id: { gt: cursor },
        OR: [{ botId: null }, { botId: { in: [...botIds] } }],
      },
      orderBy: { id: "asc" },
      take: PAGE,
    });
    for (const document of documents) {
      yield {
        type: "memory_document",
        id: document.id,
        botId: document.botId,
        scope: document.scope,
        path: document.path,
        content: document.content,
        revision: document.revision,
        createdAt: iso(document.createdAt),
        updatedAt: iso(document.updatedAt),
      };
      for (let revision = -1; ; ) {
        const revisions = await prisma.memoryRevision.findMany({
          where: { documentId: document.id, revision: { gt: revision } },
          orderBy: { revision: "asc" },
          take: PAGE,
        });
        for (const row of revisions)
          yield {
            type: "memory_revision",
            id: row.id,
            documentId: document.id,
            revision: row.revision,
            content: row.content,
            sourceThreadId: ownThread(row.sourceThreadId),
            createdAt: iso(row.createdAt),
          };
        if (revisions.length < PAGE) break;
        revision = revisions.at(-1)!.revision;
      }
    }
    if (documents.length < PAGE) break;
    cursor = documents.at(-1)!.id;
  }

  const routines = await prisma.routine.findMany({
    where: { ...tenant, botId: { in: [...botIds] } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  for (const routine of routines)
    yield {
      type: "routine",
      id: routine.id,
      botId: routine.botId,
      threadId: ownThread(routine.threadId),
      name: routine.name,
      prompt: routine.prompt,
      crons: routine.crons,
      timezone: routine.timezone,
      active: routine.active,
      notify: routine.notify,
      messageProvider: routine.messageProvider,
      modelProvider: routine.modelProvider,
      modelId: routine.modelId,
      thinkingLevel: routine.thinkingLevel,
      watch: json(routine.watch),
      createdAt: iso(routine.createdAt),
    };

  const skills = await prisma.agentSkill.findMany({
    where: { ...tenant, source: "user" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  for (const skill of skills)
    yield {
      type: "agent_skill",
      id: skill.id,
      name: skill.name,
      description: skill.description,
      content: skill.content,
      files: json(skill.files),
      createdAt: iso(skill.createdAt),
    };
}
