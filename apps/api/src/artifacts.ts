import { createHash } from "node:crypto";
import type { ArtifactStore } from "@labradoodle/adapter-kit";
import { createAdapterContext } from "@labradoodle/adapter-kit";
import type { Actor } from "@labradoodle/contracts";
import {
  attachmentMaxCount,
  isAttachmentAudioMimeType,
  MCP_APP_MIME_TYPE,
} from "@labradoodle/contracts";
import {
  AttachmentValidationError,
  decodeAttachmentBase64,
  inferAttachmentMimeType,
  messageBlockForArtifact,
  promptTextForAttachments,
  validateAttachmentMimeType,
} from "@labradoodle/core";
import type { PrismaClient } from "@labradoodle/db";
import { IsolationError, Prisma, withResolvedArtifactVersion } from "@labradoodle/db";

export async function createOwnedArtifact(
  deps: {
    prisma: PrismaClient;
    artifacts: ArtifactStore;
    maxUploadSizeBytes?: number;
  },
  actor: Actor,
  input: {
    threadId: string;
    name: string;
    description?: string;
    mimeType: string;
    contentBase64: string;
    clientNonce?: string;
  },
) {
  const replayed = await findReplayedArtifact(deps.prisma, actor, input);
  if (replayed) return createdArtifact(replayed);
  const inferredType = inferAttachmentMimeType(input.name, input.mimeType);
  const mimeType =
    inferredType && (inferredType === "application/zip" || isAttachmentAudioMimeType(inferredType))
      ? inferredType
      : input.mimeType;
  validateAttachmentMimeType(mimeType);
  const bytes = decodeAttachmentBase64(input.contentBase64, deps.maxUploadSizeBytes);
  return storeOwnedArtifact(deps, actor, { ...input, mimeType, bytes });
}

type ArtifactOwner = Pick<Actor, "spaceId" | "userId">;

async function storeOwnedArtifact(
  deps: { prisma: PrismaClient; artifacts: ArtifactStore },
  actor: ArtifactOwner,
  input: {
    threadId: string;
    name: string;
    description?: string;
    mimeType: string;
    bytes: Uint8Array;
    clientNonce?: string;
  },
) {
  const { mimeType, bytes } = input;
  const context = createAdapterContext(actor, input.threadId, `artifact-create:${input.threadId}`);
  const stored = await deps.artifacts.put({ name: input.name, mimeType, bytes }, context);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const { row, replay } = await withResolvedArtifactVersion(
    deps.prisma,
    { spaceId: actor.spaceId, threadId: input.threadId, name: input.name },
    async (tx, { rootArtifactId, version }) => {
      // A retry of the same upload has the same name and target, so it waits on the same lock.
      const raced = await findReplayedArtifact(tx, actor, input);
      if (raced) return { row: raced, replay: true };
      const created = await tx.artifact.create({
        data: {
          spaceId: actor.spaceId,
          userId: actor.userId,
          threadId: input.threadId,
          name: input.name,
          description: input.description?.trim() || null,
          mimeType,
          size: bytes.byteLength,
          hash,
          storageKey: stored.id,
          rootArtifactId,
          version,
          clientNonce: input.clientNonce,
        },
      });
      return { row: created, replay: false };
    },
  ).catch(async (error) => {
    await deps.artifacts.remove(stored.id, context).catch(() => undefined);
    throw error;
  });
  if (replay) await deps.artifacts.remove(stored.id, context).catch(() => undefined);
  return createdArtifact(row);
}

/** The artifact an earlier upload with this nonce created; a nonce reused for another chat is refused. */
async function findReplayedArtifact(
  db: Pick<Prisma.TransactionClient, "artifact">,
  actor: ArtifactOwner,
  input: { threadId: string; clientNonce?: string },
) {
  if (!input.clientNonce) return null;
  const row = await db.artifact.findFirst({
    where: { spaceId: actor.spaceId, userId: actor.userId, clientNonce: input.clientNonce },
  });
  if (!row) return null;
  if (row.threadId !== input.threadId) throw new IsolationError();
  return row;
}

function createdArtifact(row: Prisma.ArtifactGetPayload<Record<string, never>>) {
  return {
    id: row.id,
    threadId: row.threadId,
    runId: row.runId,
    name: row.name,
    description: row.description,
    mimeType: row.mimeType,
    size: row.size,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getOwnedArtifact(
  deps: {
    prisma: PrismaClient;
    artifacts: ArtifactStore;
  },
  actor: Actor,
  input: { threadId: string; artifactId: string },
) {
  const row = await deps.prisma.artifact.findFirst({
    where: { id: input.artifactId, threadId: input.threadId, spaceId: actor.spaceId },
  });
  if (!row) throw new IsolationError();
  return readArtifact(deps.artifacts, actor, row);
}

// Row-level security limits the read to chats the caller is in.
export async function getSpaceArtifactById(
  deps: {
    prisma: PrismaClient;
    artifacts: ArtifactStore;
  },
  actor: Actor,
  input: { artifactId: string },
) {
  const row = await deps.prisma.artifact.findFirst({
    where: {
      id: input.artifactId,
      spaceId: actor.spaceId,
    },
  });
  if (!row) throw new IsolationError();
  return readArtifact(deps.artifacts, actor, row);
}

async function readArtifact(
  artifacts: ArtifactStore,
  actor: Actor,
  row: {
    id: string;
    threadId: string;
    runId: string | null;
    storageKey: string;
    name: string;
    description: string | null;
    mimeType: string;
    size: number;
    version: number;
    createdAt: Date;
  },
) {
  const bytes = await artifacts.get(
    row.storageKey,
    createAdapterContext(actor, row.threadId, `artifact-get:${row.id}`),
  );
  return {
    id: row.id,
    threadId: row.threadId,
    runId: row.runId,
    name: row.name,
    description: row.description,
    mimeType: row.mimeType,
    size: row.size,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    contentBase64: Buffer.from(bytes).toString("base64"),
  };
}

type ListSpaceRow = {
  id: string;
  familyId: string;
  threadId: string;
  runId: string | null;
  name: string;
  description: string | null;
  mimeType: string;
  size: number;
  version: number;
  createdAt: Date;
  versionCount: bigint | number;
};

export class ArtifactListCursorError extends Error {
  constructor() {
    super("Invalid artifact cursor");
    this.name = "ArtifactListCursorError";
  }
}

type ArtifactListCursor = {
  createdAt: string;
  id: string;
  threadId: string | null;
  // Freezes the version set for this page sequence.
  asOf: string;
};

const ARTIFACT_LIST_CURSOR_PREFIX = "v1.";

function encodeArtifactListCursor(cursor: ArtifactListCursor): string {
  return (
    ARTIFACT_LIST_CURSOR_PREFIX + Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")
  );
}

function decodeArtifactListCursor(value: string): ArtifactListCursor {
  if (!value.startsWith(ARTIFACT_LIST_CURSOR_PREFIX)) throw new ArtifactListCursorError();
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      Buffer.from(value.slice(ARTIFACT_LIST_CURSOR_PREFIX.length), "base64url").toString("utf8"),
    );
  } catch {
    throw new ArtifactListCursorError();
  }
  if (typeof parsed !== "object" || parsed === null) throw new ArtifactListCursorError();
  const record = parsed as Record<string, unknown>;
  if (
    typeof record.createdAt !== "string" ||
    typeof record.id !== "string" ||
    !record.id ||
    typeof record.asOf !== "string"
  ) {
    throw new ArtifactListCursorError();
  }
  const threadId = cursorThreadId(record.threadId);
  const createdAt = new Date(record.createdAt);
  const asOf = new Date(record.asOf);
  if (Number.isNaN(createdAt.getTime()) || Number.isNaN(asOf.getTime())) {
    throw new ArtifactListCursorError();
  }
  return { createdAt: createdAt.toISOString(), id: record.id, threadId, asOf: asOf.toISOString() };
}

function cursorThreadId(value: unknown): string | null {
  if (value === null || typeof value === "string") return value;
  throw new ArtifactListCursorError();
}

export async function listSpaceArtifacts(
  deps: { prisma: Pick<PrismaClient, "artifact" | "$queryRaw"> },
  actor: Actor,
  input: { threadId?: string; cursor?: string; limit?: number },
) {
  const take = Math.min(Math.max(input.limit ?? 30, 1), 60);
  const scopeThreadId = input.threadId ?? null;
  const threadFilter = scopeThreadId ? Prisma.sql`AND "threadId" = ${scopeThreadId}` : Prisma.empty;

  let asOf = new Date();
  let cursorFilter = Prisma.empty;
  if (input.cursor) {
    // Position is stored on the cursor so a deleted row cannot replay the first page.
    const cursor = decodeArtifactListCursor(input.cursor);
    if (cursor.threadId !== scopeThreadId) throw new ArtifactListCursorError();
    asOf = new Date(cursor.asOf);
    cursorFilter = Prisma.sql`AND (latest."createdAt", latest.id) < (${new Date(cursor.createdAt)}, ${cursor.id})`;
  }

  const rows = await deps.prisma.$queryRaw<ListSpaceRow[]>(Prisma.sql`
    WITH scoped AS (
      SELECT * FROM "artifacts"
      WHERE "spaceId" = ${actor.spaceId} ${threadFilter}
        AND "createdAt" <= ${asOf} AND "mimeType" <> ${MCP_APP_MIME_TYPE}
    ),
    latest AS (
      SELECT DISTINCT ON (COALESCE("rootArtifactId", id))
        id, "threadId", "runId", name, description, "mimeType", size, version, "createdAt", "rootArtifactId"
      FROM scoped
      ORDER BY COALESCE("rootArtifactId", id), version DESC
    ),
    counts AS (
      SELECT COALESCE("rootArtifactId", id) AS "familyId", COUNT(*)::int AS "versionCount"
      FROM scoped
      GROUP BY COALESCE("rootArtifactId", id)
    )
    SELECT latest.id, COALESCE(latest."rootArtifactId", latest.id) AS "familyId",
           latest."threadId", latest."runId", latest.name,
           latest.description, latest."mimeType", latest.size, latest.version, latest."createdAt",
           counts."versionCount"
    FROM latest
    JOIN counts ON counts."familyId" = COALESCE(latest."rootArtifactId", latest.id)
    WHERE true ${cursorFilter}
    ORDER BY latest."createdAt" DESC, latest.id DESC
    LIMIT ${take + 1}
  `);

  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  const last = page.at(-1);

  return {
    // id is the family root so the card URL stays stable across versions.
    items: page.map((row) => ({
      id: row.familyId,
      threadId: row.threadId,
      runId: row.runId,
      name: row.name,
      description: row.description,
      mimeType: row.mimeType,
      size: row.size,
      version: row.version,
      versionCount: Number(row.versionCount),
      createdAt: row.createdAt.toISOString(),
    })),
    nextCursor:
      hasMore && last
        ? encodeArtifactListCursor({
            createdAt: last.createdAt.toISOString(),
            id: last.id,
            threadId: scopeThreadId,
            asOf: asOf.toISOString(),
          })
        : null,
  };
}

export async function listArtifactVersions(
  deps: { prisma: Pick<PrismaClient, "artifact"> },
  actor: Actor,
  input: { familyId: string },
) {
  const anchor = await deps.prisma.artifact.findFirst({
    where: { id: input.familyId, spaceId: actor.spaceId },
    select: { id: true, rootArtifactId: true },
  });
  if (!anchor) throw new IsolationError();
  const rootId = anchor.rootArtifactId ?? anchor.id;
  const rows = await deps.prisma.artifact.findMany({
    where: {
      spaceId: actor.spaceId,
      OR: [{ id: rootId }, { rootArtifactId: rootId }],
    },
    orderBy: { version: "desc" },
  });
  return rows.map((row) => ({
    id: row.id,
    version: row.version,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
  }));
}

type ArtifactMember = { id: string; storageKey: string; threadId: string };

// Delete each blob before its row, and the root only while it has no versions.
export async function deleteArtifactFamily(
  deps: { prisma: PrismaClient; artifacts: ArtifactStore },
  actor: Actor,
  input: { familyId: string },
) {
  const anchor = await deps.prisma.artifact.findFirst({
    where: { id: input.familyId, spaceId: actor.spaceId },
    select: { id: true, rootArtifactId: true },
  });
  if (!anchor) throw new IsolationError();
  const rootId = anchor.rootArtifactId ?? anchor.id;

  for (;;) {
    const members = await deps.prisma.artifact.findMany({
      where: {
        spaceId: actor.spaceId,
        OR: [{ id: rootId }, { rootArtifactId: rootId }],
      },
      select: { id: true, storageKey: true, threadId: true },
    });
    if (members.length === 0) return { ok: true as const };
    const child = members.find((row) => row.id !== rootId);
    if (child) {
      await removeArtifactBlob(deps.artifacts, actor, child);
      await deleteArtifactRowIfPresent(deps.prisma, child.id);
      continue;
    }
    const root = members.find((row) => row.id === rootId);
    if (!root) throw new IsolationError();
    const outcome = await deleteArtifactRootIfChildless(deps, actor, root);
    if (outcome === "has-child") continue;
    return { ok: true as const };
  }
}

async function deleteArtifactRootIfChildless(
  deps: { prisma: PrismaClient; artifacts: ArtifactStore },
  actor: Actor,
  root: ArtifactMember,
): Promise<"deleted" | "gone" | "has-child"> {
  let outcome: "deleted" | "gone" | "has-child" = "gone";
  await deps.prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM "artifacts" WHERE id = ${root.id} FOR UPDATE
    `);
    if (locked.length === 0) {
      outcome = "gone";
      return;
    }
    const child = await tx.artifact.findFirst({
      where: { rootArtifactId: root.id },
      select: { id: true },
    });
    if (child) {
      outcome = "has-child";
      return;
    }
    await removeArtifactBlob(deps.artifacts, actor, root);
    try {
      await tx.artifact.delete({ where: { id: root.id } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        outcome = "gone";
        return;
      }
      throw error;
    }
    outcome = "deleted";
  });
  return outcome;
}

async function removeArtifactBlob(
  artifacts: ArtifactStore,
  actor: Actor,
  member: ArtifactMember,
): Promise<void> {
  try {
    await artifacts.remove(
      member.storageKey,
      createAdapterContext(actor, member.threadId, `artifact-delete:${member.id}`),
    );
  } catch (error) {
    if (isAlreadyRemoved(error)) return;
    throw error;
  }
}

function isAlreadyRemoved(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? error.code : undefined;
  const name = "name" in error ? error.name : undefined;
  return (
    code === "ENOENT" ||
    code === "ENOTDIR" ||
    code === "NoSuchKey" ||
    name === "NotFound" ||
    name === "NoSuchKey"
  );
}

async function deleteArtifactRowIfPresent(
  prisma: Pick<PrismaClient, "artifact">,
  id: string,
): Promise<void> {
  try {
    await prisma.artifact.delete({ where: { id } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return;
    throw error;
  }
}

type SendAttachmentRow = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  storageKey: string;
};

function normalizeAttachmentIds(artifactIds: string[] | undefined, maxCount: number) {
  const ids = [...new Set(artifactIds ?? [])];
  if (ids.length > maxCount) {
    throw new AttachmentValidationError(`At most ${maxCount} attachments per message`);
  }
  return ids;
}

function toAttachmentResolution<T extends SendAttachmentRow>(ids: string[], rows: T[]) {
  if (rows.length !== ids.length) throw new IsolationError();
  const byId = new Map(rows.map((row) => [row.id, row]));
  const artifacts = ids.map((id) => byId.get(id)!);
  const blocks = artifacts.map((row) =>
    messageBlockForArtifact({
      id: row.id,
      name: row.name,
      mimeType: row.mimeType,
      size: row.size,
    }),
  );
  return { blocks, artifacts };
}

/** A send attaches only files of its own chat. */
export async function resolveSendAttachments(
  deps: { prisma: Pick<PrismaClient, "artifact">; maxAttachmentsPerMessage?: number },
  actor: Actor,
  threadId: string,
  artifactIds: string[] | undefined,
) {
  const ids = normalizeAttachmentIds(artifactIds, attachmentMaxCount(deps));
  if (!ids.length) return toAttachmentResolution(ids, [] as SendAttachmentRow[]);

  const rows = await deps.prisma.artifact.findMany({
    where: { id: { in: ids }, threadId, spaceId: actor.spaceId },
  });
  return toAttachmentResolution(ids, rows);
}

export function buildUserMessageBlocks(
  text: string | undefined,
  attachmentBlocks: ReturnType<typeof messageBlockForArtifact>[],
) {
  const blocks = [];
  const caption = text?.trim();
  if (caption) blocks.push({ kind: "text" as const, text: caption });
  blocks.push(...attachmentBlocks);
  return blocks;
}

export function buildSendPrompt(
  text: string | undefined,
  artifacts: Array<{ name: string; mimeType: string; size: number }>,
  connectorNames: string[] = [],
) {
  const prompt = promptTextForAttachments(text, artifacts);
  if (connectorNames.length === 0) return prompt;
  const marker = "Use these connectors if relevant:";
  const existing = new RegExp(`^${marker} (.*)\\.$`, "m").exec(prompt);
  const names = [
    ...new Set([
      ...(existing?.[1]
        ?.split(",")
        .map((name) => name.trim())
        .filter(Boolean) ?? []),
      ...connectorNames.map((name) => name.trim()).filter(Boolean),
    ]),
  ];
  const line = `${marker} ${names.join(", ")}.`;
  if (existing) return prompt.replace(existing[0], () => line);
  return prompt ? `${prompt}\n\n${line}` : line;
}
