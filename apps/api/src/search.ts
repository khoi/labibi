import type { Actor, Chat, MessageBlock, SearchHit } from "@labradoodle/contracts";
import {
  escapeJsonSearchWildcards,
  escapeSearchWildcards,
  extractLinksFromText,
  matchesSearchQuery,
  snippetAroundMatch,
} from "@labradoodle/core";
import type { PrismaClient } from "@labradoodle/db";
import {
  contentEncryptionOf,
  INDEXED_MESSAGE,
  LISTED_ARTIFACT,
  listChats,
  Prisma,
  UNINDEXED_MESSAGE,
} from "@labradoodle/db";

const SEARCH_LIMIT = 25;
/** Cap chat-name matches so content hits (messages/files/links/routines) keep most of the budget. */
const CONVERSATION_HIT_LIMIT = 5;
/** Recent encrypted messages scanned when no query term is long enough to be indexed. */
const UNINDEXED_SCAN_LIMIT = 200;

/**
 * Encrypted messages match on blind-index prefix tokens, then decrypt and filter
 * in `pushMessageHits`; rows not yet encrypted keep the substring match. Index
 * matches are whole words or word prefixes, so text inside a word only matches
 * on rows that are still plaintext.
 */
async function messageMatch(prisma: PrismaClient, spaceId: string, query: string) {
  const plaintext = Prisma.sql`m.blocks::text ILIKE ${`%${escapeJsonSearchWildcards(query)}%`}`;
  const encryption = contentEncryptionOf(prisma);
  if (!encryption) return { sql: plaintext, limit: SEARCH_LIMIT, pages: 1 };
  const keyTokens = await encryption.messageSearchTokens(spaceId, query, "prefix");
  // No keys: nothing in the space was ever encrypted (encryption off from the start).
  if (!keyTokens.length) return { sql: plaintext, limit: SEARCH_LIMIT, pages: 1 };
  const tokenSets = keyTokens.filter((tokens) => tokens.length);
  if (!tokenSets.length)
    return {
      sql: Prisma.sql`(${INDEXED_MESSAGE} OR ${plaintext})`,
      limit: UNINDEXED_SCAN_LIMIT,
      pages: 1,
    };
  const encrypted = tokenSets.map((tokens) => Prisma.sql`m."searchTokens" @> ${tokens}::int[]`);
  return {
    sql: Prisma.sql`(${Prisma.join([...encrypted, Prisma.sql`(${UNINDEXED_MESSAGE} AND ${plaintext})`], " OR ")})`,
    limit: SEARCH_LIMIT * 4,
    // Candidates can share the query's words without containing the phrase, so
    // keep fetching until results fill or candidates run out, within a bound.
    pages: 5,
  };
}

async function openMessages<T extends { id: string }>(prisma: PrismaClient, rows: T[]) {
  return (await contentEncryptionOf(prisma)?.openRows("Message", rows)) ?? rows;
}

/** The newest message of the chat that shows each file, so a hit opens where it was shared. */
async function findArtifactMessages(
  prisma: PrismaClient,
  artifacts: Array<{ id: string; threadId: string }>,
): Promise<Map<string, { id: string; seq: number }>> {
  if (artifacts.length === 0) return new Map();
  const candidates = Prisma.join(
    artifacts.map(({ id, threadId }) => Prisma.sql`(${id}, ${threadId})`),
  );
  const rows = await prisma.$queryRaw<Array<{ artifactId: string; id: string; seq: number }>>(
    Prisma.sql`
      SELECT candidate."artifactId", message.id, message.seq
      FROM (VALUES ${candidates}) AS candidate("artifactId", "threadId")
      CROSS JOIN LATERAL (
        SELECT m.id, m.seq
        FROM messages m
        WHERE m."threadId" = candidate."threadId"
          AND m.blocks::text ILIKE ('%' || candidate."artifactId" || '%')
        ORDER BY m."createdAt" DESC
        LIMIT 1
      ) message
    `,
  );
  return new Map(rows.map(({ artifactId, id, seq }) => [artifactId, { id, seq }]));
}

/**
 * Search the caller's chats in this workspace. Row-level security already leaves out every chat
 * they are not in; the chat list scopes each query to those chats too.
 */
export async function querySpaceSearch(
  prisma: PrismaClient,
  actor: Actor,
  q: string,
): Promise<SearchHit[]> {
  const query = q.trim();
  if (!query) return [];
  // The database side has to match the text the user typed, the way
  // `matchesSearchQuery` does in memory: a `%` or `_` would otherwise widen
  // the match, and a `\` would swallow the character after it.
  const likeQuery = escapeSearchWildcards(query);
  const chats = await listChats(prisma, actor);
  if (chats.length === 0) return [];
  const chatById = new Map(chats.map((chat) => [chat.id, chat]));
  const threadIds = chats.map((chat) => chat.id);
  const inChat = (threadId: string) => chatById.get(threadId) as Chat;

  const conversationHits: SearchHit[] = [];
  const contentHits: SearchHit[] = [];
  const seen = new Set<string>();

  function pushInto(bucket: SearchHit[], hit: SearchHit, limit: number) {
    const key = [
      hit.kind,
      hit.threadId,
      hit.messageId ?? "",
      hit.artifactId ?? "",
      hit.routineId ?? "",
      hit.url ?? "",
    ].join(":");
    if (seen.has(key) || bucket.length >= limit) return;
    seen.add(key);
    bucket.push(hit);
  }

  for (const chat of chats) {
    if (!matchesSearchQuery(query, chat.title)) continue;
    pushInto(
      conversationHits,
      {
        kind: "conversation",
        threadId: chat.id,
        chatTitle: chat.title,
        title: chat.title,
        snippet: chat.preview,
      },
      CONVERSATION_HIT_LIMIT,
    );
  }

  const contentBudget = Math.max(0, SEARCH_LIMIT - conversationHits.length);
  const full = () => contentHits.length >= contentBudget;

  const artifacts = await prisma.artifact.findMany({
    where: {
      spaceId: actor.spaceId,
      threadId: { in: threadIds },
      name: { contains: likeQuery, mode: "insensitive" },
      ...LISTED_ARTIFACT,
    },
    take: SEARCH_LIMIT,
  });
  const artifactMessages = await findArtifactMessages(prisma, artifacts);
  for (const artifact of artifacts) {
    const message = artifactMessages.get(artifact.id);
    if (!message) continue;
    pushInto(
      contentHits,
      {
        kind: "file",
        threadId: artifact.threadId,
        chatTitle: inChat(artifact.threadId).title,
        title: artifact.name,
        snippet: `${artifact.mimeType}, ${artifact.size} bytes`,
        artifactId: artifact.id,
        messageId: message.id,
        seq: message.seq,
      },
      contentBudget,
    );
  }

  if (full()) return [...conversationHits, ...contentHits];

  const routines = await prisma.routine.findMany({
    where: {
      spaceId: actor.spaceId,
      threadId: { in: threadIds },
      OR: [
        { name: { contains: likeQuery, mode: "insensitive" } },
        { prompt: { contains: likeQuery, mode: "insensitive" } },
      ],
    },
    take: SEARCH_LIMIT,
  });
  for (const routine of routines) {
    pushInto(
      contentHits,
      {
        kind: "routine",
        threadId: routine.threadId,
        chatTitle: inChat(routine.threadId).title,
        title: routine.name,
        snippet: snippetAroundMatch(routine.prompt, query),
        routineId: routine.id,
      },
      contentBudget,
    );
  }

  if (full()) return [...conversationHits, ...contentHits];

  const match = await messageMatch(prisma, actor.spaceId, query);
  for (let page = 0; page < match.pages && !full(); page += 1) {
    const messageRows = await openMessages(
      prisma,
      await prisma.$queryRaw<
        Array<{ id: string; threadId: string; seq: number; blocks: Prisma.JsonValue }>
      >`
      SELECT m.id, m."threadId", m.seq, m.blocks
      FROM messages m
      WHERE m."threadId" IN (${Prisma.join(threadIds)})
        AND ${match.sql}
      ORDER BY m."createdAt" DESC, m.id DESC
      LIMIT ${match.limit} OFFSET ${page * match.limit}
    `,
    );
    for (const row of messageRows) {
      pushMessageHits(row.blocks as MessageBlock[], {
        threadId: row.threadId,
        chatTitle: inChat(row.threadId).title,
        messageId: row.id,
        seq: row.seq,
        query,
        push: (hit) => pushInto(contentHits, hit, contentBudget),
      });
    }
    if (messageRows.length < match.limit) break;
  }

  return [...conversationHits, ...contentHits].slice(0, SEARCH_LIMIT);
}

function pushMessageHits(
  blocks: MessageBlock[],
  ctx: {
    threadId: string;
    chatTitle: string;
    messageId: string;
    seq: number;
    query: string;
    push: (hit: SearchHit) => void;
  },
) {
  const destination = { threadId: ctx.threadId, chatTitle: ctx.chatTitle };
  const title = ctx.chatTitle;
  let messageHit = false;
  for (const block of blocks) {
    if (block.kind !== "text") continue;
    const text = block.text;
    if (matchesSearchQuery(ctx.query, text)) {
      ctx.push({
        kind: "message",
        ...destination,
        title,
        snippet: snippetAroundMatch(text, ctx.query),
        messageId: ctx.messageId,
        seq: ctx.seq,
      });
      messageHit = true;
    }
    for (const url of extractLinksFromText(text)) {
      if (matchesSearchQuery(ctx.query, url)) {
        ctx.push({
          kind: "link",
          ...destination,
          title: url,
          snippet: snippetAroundMatch(text, ctx.query),
          messageId: ctx.messageId,
          seq: ctx.seq,
          url,
        });
      }
    }
  }
  if (!messageHit && matchesSearchQuery(ctx.query, JSON.stringify(blocks))) {
    ctx.push({
      kind: "message",
      ...destination,
      title,
      snippet: ctx.query,
      messageId: ctx.messageId,
      seq: ctx.seq,
    });
  }
}
