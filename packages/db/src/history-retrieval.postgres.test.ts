import { HistorySearchInputSchema } from "@labradoodle/contracts";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Prisma } from "./client.js";
import { PrismaClient } from "./client.js";
import { readHistory, searchHistory } from "./history-retrieval.js";

// Temporary synthetic tables shadow product tables. Never inspect existing chat content.
const enabled = process.env.VERIFY_DATABASE && process.env.DATABASE_URL;
const postgres = enabled ? describe.sequential : describe.skip;
postgres("history retrieval (PostgreSQL)", () => {
  let pool: Pool;
  let prisma: PrismaClient;
  const scope = {
    spaceId: "synthetic-space",
    userId: "synthetic-user",
    threadId: "synthetic-thread",
  };
  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool, { schema: "pg_temp" }) });
    await pool.query(`
      CREATE TEMP TABLE threads (id text PRIMARY KEY, "spaceId" text, "userId" text, name text);
      CREATE TEMP TABLE thread_members ("threadId" text, "userId" text);
      CREATE TEMP TABLE messages (id text PRIMARY KEY, "threadId" text, seq integer, role text, "runId" text,
        "replyToMessageId" text, "createdAt" timestamptz, blocks jsonb);
      CREATE TEMP TABLE steering_messages ("messageId" text, "botId" text, "runId" text,
        UNIQUE ("messageId", "botId"));
      CREATE TEMP TABLE runs (id text PRIMARY KEY, "spaceId" text, "userId" text, "threadId" text, "botId" text,
        "sourceMessageId" text, status text, "createdAt" timestamptz, "completedAt" timestamptz);
      CREATE TEMP TABLE artifacts (id text PRIMARY KEY, "spaceId" text, "userId" text, "botId" text, "groupId" text,
        "runId" text, name text, "mimeType" text, size integer, "createdAt" timestamptz,
        "threadId" text DEFAULT 'synthetic-thread');
      INSERT INTO threads VALUES ('synthetic-thread','synthetic-space','synthetic-user');
      INSERT INTO thread_members VALUES ('synthetic-thread','synthetic-user');
      INSERT INTO messages SELECT 'm-' || n, 'synthetic-thread', n, 'user', NULL, NULL,
        '2026-01-01'::timestamptz + n * interval '1 minute',
        jsonb_build_array(jsonb_build_object('kind','text','text', CASE WHEN n = 100 THEN 'exports use batching' ELSE 'filler exchange ' || n END))
        FROM generate_series(1,10000) n;
      CREATE INDEX synthetic_history_fts ON messages USING GIN (to_tsvector('simple',jsonb_path_query_array(blocks,
        '$[*] ? (@.kind == "text" || @.kind == "channel_message" || @.kind == "bot_message_received" || @.kind == "bot_message_sent" || @.kind == "handoff").text')::text || jsonb_path_query_array(blocks, '$[*] ? (@.kind == "subagent").task')::text || jsonb_path_query_array(blocks, '$[*] ? (@.kind == "subagent").result')::text || translate(jsonb_path_query_array(blocks, '$[*] ? (@.kind == "file" || @.kind == "image").name')::text, '._-', '   ')));
      CREATE INDEX synthetic_history_seq ON messages ("threadId",seq);
      ANALYZE messages;
    `);
  });
  afterAll(async () => {
    await prisma?.$disconnect();
    await pool?.end();
  });
  it("finds a distant fact in 10,000 messages using the full text index", async () => {
    const querySpy = vi.spyOn(prisma, "$queryRaw");
    const results = await searchHistory(prisma, scope, { query: "exports batching" });
    const authorizedQuery = querySpy.mock.calls[0]![0] as Prisma.Sql;
    querySpy.mockRestore();
    expect(results.messages.map((message) => message.messageId)).toEqual(["m-100"]);
    const explained = await pool.query(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${authorizedQuery.text}`,
      authorizedQuery.values,
    );
    const plan = explained.rows[0]["QUERY PLAN"][0];
    expect(JSON.stringify(plan)).toContain("synthetic_history_fts");
    expect(plan.Plan["Actual Rows"]).toBe(1);
    expect(plan["Planning Time"]).toBeGreaterThanOrEqual(0);
    expect(plan["Execution Time"]).toBeGreaterThanOrEqual(0);
    process.stdout.write(
      `Synthetic authorized 10k history search ${JSON.stringify({
        messages: 10000,
        index: "equivalent local GIN expression",
        returnedRows: plan.Plan["Actual Rows"],
        planningMs: plan["Planning Time"],
        executionMs: plan["Execution Time"],
      })}\n`,
    );
  });
  it("keeps query-specific continuation available after a narrower empty query in the 10k corpus", async () => {
    await pool.query(`INSERT INTO messages SELECT 'continuation-' || n, 'synthetic-thread', n, 'user', NULL, NULL,
      '2026-01-01T00:00:00Z'::timestamptz,
      jsonb_build_array(jsonb_build_object('kind','text','text',CASE WHEN n = 13001
        THEN 'continuation original ORBIT-731' ELSE 'continuation broad topic' END))
      FROM generate_series(13001,13008) n`);
    const historicalScope = { ...scope, searchBeforeSeq: 13008 };
    const broad = await searchHistory(prisma, historicalScope, {
      query: " continuation ",
      beforeSeq: 999999,
      limit: 20,
      after: "2026-01-01T00:00:00Z",
      before: "2026-01-02T00:00:00Z",
    });
    expect(broad.messages.map((message) => message.seq)).toEqual([
      13007, 13006, 13005, 13004, 13003,
    ]);
    expect(broad.coverage.status).toBe("partial");
    expect(broad.nextSearch).toEqual({
      query: "continuation",
      beforeSeq: 13003,
      limit: 5,
      after: "2026-01-01T00:00:00Z",
      before: "2026-01-02T00:00:00Z",
    });
    const narrow = await searchHistory(prisma, historicalScope, {
      query: "continuation identifier",
    });
    expect(narrow).toMatchObject({
      query: "continuation identifier",
      messages: [],
      coverage: {
        scope: "requested_query_and_range",
        status: "exhausted",
      },
      nextSearch: null,
    });
    const older = await searchHistory(prisma, historicalScope, broad.nextSearch!);
    expect(older.messages.map((message) => message.seq)).toEqual([13002, 13001]);
    expect(older.messages[1]!.text).toContain("ORBIT-731");
    expect(older.coverage.status).toBe("exhausted");
    expect(
      (
        await readHistory(prisma, historicalScope, {
          messageId: older.messages[1]!.messageId,
          limit: 1,
        })
      ).messages[0]!.text,
    ).toContain("ORBIT-731");
    expect(
      (
        await searchHistory(
          prisma,
          { ...historicalScope, spaceId: "foreign-space" },
          broad.nextSearch!,
        )
      ).messages,
    ).toEqual([]);
    for (const page of [broad, narrow, older])
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(10000);
  });
  it("enforces the server search boundary, preserves old pagination and keeps explicit reads available", async () => {
    const historicalScope = { ...scope, searchBeforeSeq: 10 };
    const page = await searchHistory(prisma, historicalScope, {
      query: "filler exchange",
      limit: 3,
      beforeSeq: 999999,
    });
    expect(page.messages.map((message) => message.seq)).toEqual([9, 8, 7]);
    expect(page.nextBeforeSeq).toBe(7);
    const older = await searchHistory(prisma, historicalScope, {
      query: "filler exchange",
      limit: 3,
      beforeSeq: page.nextBeforeSeq!,
    });
    expect(older.messages.map((message) => message.seq)).toEqual([6, 5, 4]);
    const dated = await searchHistory(prisma, historicalScope, {
      query: "filler exchange",
      after: "2026-01-01T00:05:00Z",
      before: "2026-01-01T00:10:00Z",
      limit: 5,
    });
    expect(dated.messages.map((message) => message.seq)).toEqual([9, 8, 7, 6, 5]);
    expect(
      (
        await searchHistory(
          prisma,
          { ...scope, searchBeforeSeq: 0 },
          { query: "filler exchange", beforeSeq: 999999 },
        )
      ).messages,
    ).toEqual([]);
    // The cutoff belongs only to search: live explicit evidence and linked outcomes remain readable.
    expect(
      (await readHistory(prisma, historicalScope, { messageId: "m-10", limit: 1 })).messages[0]!
        .messageId,
    ).toBe("m-10");
  });
  it("uses UTC day boundaries and preserves offset instants with inclusive after and exclusive before", async () => {
    const day = await searchHistory(
      prisma,
      scope,
      HistorySearchInputSchema.parse({
        query: "filler exchange",
        after: "2026-01-01",
        before: "2026-01-02",
        limit: 3,
      }),
    );
    expect(day.messages.map((message) => message.seq)).toEqual([1439, 1438, 1437]);
    expect(day.nextSearch).toMatchObject({
      after: "2026-01-01T00:00:00.000Z",
      before: "2026-01-02T00:00:00.000Z",
    });
    const offset = await searchHistory(
      prisma,
      scope,
      HistorySearchInputSchema.parse({
        query: "filler exchange",
        after: "2026-01-02T02:00:00+02:00",
        before: "2026-01-02T02:03:00+02:00",
        limit: 5,
      }),
    );
    expect(offset.messages.map((message) => message.seq)).toEqual([1442, 1441, 1440]);
    expect(offset.nextSearch).toBeNull();
  });
  it("finds earlier files by name and lists only files that still belong to the space", async () => {
    await pool.query(`
      INSERT INTO messages VALUES
        ('file-captioned','synthetic-thread',12001,'user',NULL,NULL,now(),
          '[{"kind":"text","text":"Signed copy attached"},{"kind":"file","artifactId":"art-lease","name":"lisbon-office-lease.md","mimeType":"text/markdown","size":64}]'),
        ('file-bare','synthetic-thread',12002,'user',NULL,NULL,now(),
          '[{"kind":"file","artifactId":"art-foreign","name":"porto-warehouse.md","mimeType":"text/markdown","size":64}]');
      INSERT INTO artifacts VALUES
        ('art-lease','synthetic-space','synthetic-user','synthetic-bot',NULL,NULL,'lisbon-office-lease.md','text/markdown',64,now()),
        ('art-foreign','foreign-space','outsider','synthetic-bot',NULL,NULL,'porto-warehouse.md','text/markdown',64,now());
    `);
    const lease = {
      artifactId: "art-lease",
      name: "lisbon-office-lease.md",
      mimeType: "text/markdown",
      size: 64,
      path: "attachments/art-lease.md",
    };
    const found = await searchHistory(prisma, scope, { query: "lisbon lease" });
    expect(
      (await searchHistory(prisma, scope, { query: "lisbon-office-lease.md" })).messages,
    ).toHaveLength(1);
    // One word from the caption, one from the file name.
    expect((await searchHistory(prisma, scope, { query: "signed lease" })).messages).toHaveLength(
      1,
    );
    expect(found.messages).toEqual([
      expect.objectContaining({
        messageId: "file-captioned",
        text: "Signed copy attached",
        attachments: [lease],
      }),
    ]);
    // A name match on a file from another space finds the message but never the file.
    const foreign = await searchHistory(prisma, scope, {
      query: "porto",
      kinds: ["user_messages"],
    });
    expect(foreign.messages.map((message) => message.messageId)).toEqual(["file-bare"]);
    expect(foreign.messages[0]).not.toHaveProperty("attachments");
    const read = await readHistory(prisma, scope, { messageId: "file-captioned" });
    expect(read.messages.find((message) => message.messageId === "file-captioned")).toMatchObject({
      attachments: [lease],
    });
    await pool.query("DELETE FROM artifacts WHERE id = 'art-lease'");
    const afterDelete = await readHistory(prisma, scope, { messageId: "file-captioned" });
    expect(afterDelete.messages.every((message) => !("attachments" in message))).toBe(true);
    await pool.query("DELETE FROM messages WHERE id IN ('file-captioned','file-bare')");
    await pool.query("DELETE FROM artifacts WHERE id = 'art-foreign'");
  });
  it("keeps a message with many files within the response budget and pages through them", async () => {
    // 100 files with long names, as a deployment that raises the per-message limit allows.
    await pool.query(`
      INSERT INTO artifacts SELECT 'many-' || n, 'synthetic-space', 'synthetic-user', 'synthetic-bot', NULL, NULL,
        repeat('n', 200) || n || '.md', 'text/markdown', 1, now() FROM generate_series(1,100) n;
      INSERT INTO messages VALUES ('many-files-neighbor','synthetic-thread',12099,'bot',NULL,NULL,now(),
        '[{"kind":"text","text":"Neighbor context keeps every word of this reply."}]');
      INSERT INTO messages VALUES ('many-files','synthetic-thread',12100,'user',NULL,NULL,now(),
        (SELECT jsonb_agg(jsonb_build_object('kind','file','artifactId','many-' || n,
          'name', repeat('n', 200) || n || '.md','mimeType','text/markdown','size',1)) FROM generate_series(1,100) n));
    `);
    // Files give way before nearby text does.
    const around = await readHistory(prisma, scope, { messageId: "many-files", limit: 3 });
    expect(Buffer.byteLength(JSON.stringify(around))).toBeLessThanOrEqual(10_000);
    expect(around.messages.find((m) => m.messageId === "many-files-neighbor")?.text).toBe(
      "Neighbor context keeps every word of this reply.",
    );
    type Page = { attachments?: Array<{ artifactId: string }>; nextAttachmentOffset?: number };
    const seen: string[] = [];
    let attachmentOffset: number | undefined;
    for (let page = 0; page < 100; page += 1) {
      const read = await readHistory(prisma, scope, {
        messageId: "many-files",
        limit: 1,
        ...(attachmentOffset === undefined ? {} : { attachmentOffset }),
      });
      expect(Buffer.byteLength(JSON.stringify(read))).toBeLessThanOrEqual(10_000);
      const [message] = read.messages as Page[];
      // Never more files than the run copies at once, so every listed path is copied.
      expect(message!.attachments?.length ?? 0).toBeLessThanOrEqual(20);
      seen.push(...(message!.attachments ?? []).map((file) => file.artifactId));
      attachmentOffset = message!.nextAttachmentOffset;
      if (attachmentOffset === undefined) break;
    }
    // Every file is reachable by paging, each listed once.
    expect(seen.length).toBe(100);
    expect(new Set(seen).size).toBe(100);
    await pool.query("DELETE FROM messages WHERE id IN ('many-files','many-files-neighbor')");
    await pool.query("DELETE FROM artifacts WHERE id LIKE 'many-%'");
  });
  it("does not index credential prompts or tool metadata", async () => {
    await pool.query(`INSERT INTO messages VALUES
      ('secret-metadata','synthetic-thread',11000,'system',NULL,NULL,now(),
        '[{"kind":"secret_prompt","text":"synthetic credential needle"},{"kind":"progress","text":"hidden trace needle"}]')`);
    expect((await searchHistory(prisma, scope, { query: "needle" })).messages).toEqual([]);
  });
  it("indexes persisted subagent conclusions and retrieves them as linked outcomes", async () => {
    await pool.query(`INSERT INTO messages VALUES ('subagent-result','synthetic-thread',11999,'bot',NULL,NULL,now(),
      '[{"kind":"subagent","agentId":"synthetic-agent","name":"Research","task":"Inspect exports","status":"completed","result":"ledger-indexer produced aurora-investigation.txt"}]');`);
    const result = await searchHistory(prisma, scope, { query: "ledger-indexer" });
    expect(result.messages[0]!.text).toContain("ledger-indexer");
    expect(result.messages[0]!.text).toContain("aurora-investigation.txt");
  });
  it("finds an open task-only background investigation through its original-backed snapshot topic", async () => {
    await pool.query(`INSERT INTO runs VALUES ('task-only-run','synthetic-space','synthetic-user','synthetic-thread',
        'synthetic-bot',NULL,'running',now(),NULL);
      INSERT INTO messages VALUES ('task-only-message','synthetic-thread',11998,'bot','task-only-run',NULL,now(),
        '[{"kind":"subagent","agentId":"synthetic-agent","name":"Research","task":"Inspect quartz routing congestion","status":"running","result":""}]');`);
    const search = await searchHistory(prisma, scope, { query: "quartz routing congestion" });
    expect(search.messages.map((message) => message.messageId)).toEqual(["task-only-message"]);
    const read = await readHistory(prisma, scope, {
      messageId: search.messages[0]!.messageId,
      limit: 1,
    });
    expect(read.messages[0]!.text).toBe("Inspect quartz routing congestion");
    expect(read.snapshots[0]).toMatchObject({
      anchorMessageId: "task-only-message",
      topic: "Inspect quartz routing congestion",
      openRunIds: ["task-only-run"],
    });
    expect(read.runs[0]!.status).toBe("running");
    await pool.query("DELETE FROM messages WHERE id = 'task-only-message'");
    expect(
      (await searchHistory(prisma, scope, { query: "quartz routing congestion" })).messages,
    ).toEqual([]);
  });
  it("retrieves source-less background work only through a surviving private output", async () => {
    await pool.query(`INSERT INTO runs VALUES
      ('background-run','synthetic-space','synthetic-user','synthetic-thread','synthetic-bot',NULL,'completed',now(),now());
      INSERT INTO messages VALUES ('background-result','synthetic-thread',12000,'bot','background-run',NULL,now(),
        '[{"kind":"text","text":"Background investigation complete"}]');`);
    const result = await readHistory(prisma, scope, { messageId: "background-result", limit: 1 });
    expect(result.runs.map((run) => run.id)).toEqual(["background-run"]);
    await pool.query("DELETE FROM messages WHERE id = 'background-result'");
    expect((await readHistory(prisma, scope, { messageId: "background-result" })).runs).toEqual([]);
  });
  it("keeps complete JSON and pages all 50 linked runs, 100 artifacts and long original text", async () => {
    const original = `Original evidence\n${"長い\n".repeat(4000)}`;
    await pool.query(
      `INSERT INTO messages VALUES ('paging-source','synthetic-thread',15000,'user',NULL,NULL,now(), $1::jsonb)`,
      [JSON.stringify([{ kind: "text", text: original }])],
    );
    await pool.query(`
      INSERT INTO runs SELECT 'paging-run-' || lpad(n::text,2,'0'), 'synthetic-space','synthetic-user',
        'synthetic-thread','synthetic-bot','paging-source','completed',now(),now() FROM generate_series(0,49) n;
      INSERT INTO artifacts SELECT 'paging-artifact-' || lpad(n::text,3,'0'), 'synthetic-space','synthetic-user',
        'synthetic-bot',NULL,'paging-run-00','report-' || n || '.txt','text/plain',10,now() FROM generate_series(0,99) n;
      INSERT INTO messages SELECT 'paging-outcome-' || n,'synthetic-thread',15001+n,'bot','paging-run-00',NULL,now(),
        jsonb_build_array(jsonb_build_object('kind','text','text', repeat('outcome evidence ',200))) FROM generate_series(0,29) n;
    `);
    const assertBounded = (result: unknown) => {
      const serialized = JSON.stringify(result);
      expect(Buffer.byteLength(serialized)).toBeLessThanOrEqual(10000);
      expect(JSON.parse(serialized)).toMatchObject({ untrusted: true });
      expect(serialized).not.toContain("storageKey");
    };
    const runIds = new Set<string>();
    let runAfterId: string | undefined;
    do {
      const page = await readHistory(prisma, scope, {
        messageId: "paging-source",
        limit: 1,
        runAfterId,
      });
      assertBounded(page);
      for (const run of page.runs) runIds.add(run.id);
      runAfterId = page.nextRunId ?? undefined;
    } while (runAfterId);
    expect(runIds.size).toBe(50);
    const artifactIds = new Set<string>();
    let artifactAfterId: string | undefined;
    do {
      const page = await readHistory(prisma, scope, {
        messageId: "paging-source",
        limit: 1,
        linkedRunId: "paging-run-00",
        artifactAfterId,
      });
      assertBounded(page);
      for (const artifact of page.runs.flatMap((run) => run.artifacts))
        artifactIds.add(artifact.id);
      artifactAfterId = page.nextArtifactId ?? undefined;
    } while (artifactAfterId);
    expect(artifactIds.size).toBe(100);
    const outcomeIds = new Set<string>();
    let outcomeAfterSeq: number | undefined;
    do {
      const page = await readHistory(prisma, scope, {
        messageId: "paging-source",
        limit: 1,
        linkedRunId: "paging-run-00",
        outcomeAfterSeq,
      });
      assertBounded(page);
      for (const outcome of page.runs.flatMap((run) => run.outcomes))
        outcomeIds.add(outcome.messageId);
      outcomeAfterSeq = page.nextOutcomeSeq ?? undefined;
    } while (outcomeAfterSeq !== undefined);
    expect(outcomeIds.size).toBe(30);
    let collected = "";
    let textOffset: number | undefined = 0;
    do {
      const page = await readHistory(prisma, scope, {
        messageId: "paging-source",
        textOffset,
        linkedRunId: "paging-run-00",
      });
      assertBounded(page);
      collected += page.messages[0]!.text;
      const next = page.messages[0]!.nextTextOffset ?? undefined;
      if (next !== undefined) expect(next).toBeGreaterThan(textOffset!);
      textOffset = next;
    } while (textOffset !== undefined);
    expect(collected).toBe(original);
    expect(
      (await readHistory(prisma, scope, { messageId: "m-1", linkedRunId: "paging-run-00" })).runs,
    ).toEqual([]);
  });
  it("searches original-backed snapshots and pages from a short source to linked outcomes and open work", async () => {
    await pool.query(`INSERT INTO messages VALUES ('navigation-source','synthetic-thread',16000,'user',NULL,NULL,now(),
      '[{"kind":"text","text":"Inspect the navigation canary"}]');
      INSERT INTO runs VALUES ('navigation-open-run','synthetic-space','synthetic-user','synthetic-thread','synthetic-bot',
        'navigation-source','running',now(),NULL),
        ('navigation-complete-run','synthetic-space','synthetic-user','synthetic-thread','synthetic-bot',
        'navigation-source','completed',now(),now());
      INSERT INTO messages VALUES ('navigation-result','synthetic-thread',16001,'bot','navigation-complete-run',NULL,now(),
        '[{"kind":"subagent","task":"Inspect navigation","result":"Navigation diagnostic final result: ledger-indexer"}]');`);
    const search = await searchHistory(prisma, scope, { query: "navigation canary", limit: 1 });
    expect(search.messages[0]!.messageId).toBe("navigation-source");
    const source = await readHistory(prisma, scope, {
      messageId: search.messages[0]!.messageId,
      limit: 1,
    });
    expect(source.snapshots[0]).toMatchObject({
      anchorMessageId: "navigation-source",
      fromSeq: 16000,
      toSeq: 16000,
      source: "original",
      topic: "Inspect the navigation canary",
      openRunIds: ["navigation-open-run"],
    });
    expect(source.snapshots[0]!.outcome).toContain("ledger-indexer");
    const newer = await readHistory(prisma, scope, {
      messageId: source.newerMessageId!,
      direction: "newer",
      limit: 1,
    });
    expect(newer.snapshots[0]!.anchorMessageId).toBe("navigation-result");
    expect(newer.messages[0]!.text).toContain("ledger-indexer");
    expect(newer.runs[0]!.id).toBe("navigation-complete-run");
    await pool.query("UPDATE runs SET status = 'completed' WHERE id = 'navigation-open-run'");
    expect(
      (await readHistory(prisma, scope, { messageId: "navigation-source", limit: 1 })).snapshots[0]!
        .openRunIds,
    ).toEqual([]);
    await pool.query("DELETE FROM messages WHERE id IN ('navigation-source','navigation-result')");
    expect((await searchHistory(prisma, scope, { query: "navigation canary" })).messages).toEqual(
      [],
    );
  });
});
