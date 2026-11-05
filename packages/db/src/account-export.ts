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
  /** The person's computer in this space, whose files go in the archive. */
  home(): Promise<{ homeKey: string } | null>;
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
      const written: Written = { artifacts: [] };
      return {
        id: space.id,
        name: space.name,
        createdAt: space.createdAt.toISOString(),
        records: () => runGeneratorAsTenant(tenant, spaceRecords(prisma, tenant, written)),
        artifacts: async function* () {
          yield* written.artifacts;
        },
        home: () =>
          runAsTenant(tenant, () =>
            prisma.computer.findUnique({
              where: { spaceId_userId: tenant },
              select: { homeKey: true },
            }),
          ),
      };
    }),
  };
}

type Written = { artifacts: Array<{ id: string; storageKey: string }> };

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
  const threadIds = new Set<string>();
  const ownThread = (id: string | null) => (id && threadIds.has(id) ? id : null);
  for (let cursor = ""; ; ) {
    const threads = await prisma.thread.findMany({
      where: {
        spaceId: tenant.spaceId,
        id: { gt: cursor },
        members: { some: { userId: tenant.userId } },
      },
      orderBy: { id: "asc" },
      take: PAGE,
      select: {
        id: true,
        name: true,
        doodle: true,
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
            createdAt: iso(message.createdAt),
          };
        if (messages.length < PAGE) break;
        seq = messages.at(-1)!.seq;
      }
    }
    if (threads.length < PAGE) break;
    cursor = threads.at(-1)!.id;
  }
  const inChats = { spaceId: tenant.spaceId, threadId: { in: [...threadIds] } };

  for (let cursor = ""; ; ) {
    const pages = await prisma.page.findMany({
      where: { ...inChats, id: { gt: cursor } },
      orderBy: { id: "asc" },
      take: PAGE,
    });
    for (const page of pages) {
      yield {
        type: "page",
        id: page.id,
        threadId: page.threadId,
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

  const artifactRecord = (row: {
    id: string;
    threadId: string;
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
      threadId: row.threadId,
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
      where: { ...inChats, id: { gt: cursor }, rootArtifactId: null },
      orderBy: { id: "asc" },
      take: PAGE,
    });
    for (const root of roots) {
      yield artifactRecord(root);
      for (let version = 0; ; ) {
        const versions = await prisma.artifact.findMany({
          where: { ...inChats, rootArtifactId: root.id, version: { gt: version } },
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
        spaceId: tenant.spaceId,
        id: { gt: cursor },
        OR: [{ threadId: null, userId: tenant.userId }, { threadId: inChats.threadId }],
      },
      orderBy: { id: "asc" },
      take: PAGE,
    });
    for (const document of documents) {
      yield {
        type: "memory_document",
        id: document.id,
        threadId: document.threadId,
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

  // Only their own: a routine runs as the person who made it.
  const routines = await prisma.routine.findMany({
    where: { ...inChats, userId: tenant.userId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  for (const routine of routines)
    yield {
      type: "routine",
      id: routine.id,
      threadId: routine.threadId,
      name: routine.name,
      prompt: routine.prompt,
      crons: routine.crons,
      timezone: routine.timezone,
      active: routine.active,
      notify: routine.notify,
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
