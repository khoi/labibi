import type { PrismaClient } from "@labradoodle/db";
import { describe, expect, it, vi } from "vitest";
import { loadAllMessages, loadMessagePage } from "./thread-message-pages.js";

describe("thread message pages", () => {
  it("names each message's author with one lookup and omits deleted accounts", async () => {
    const row = (id: string, seq: number, authorUserId: string | null, replyTo?: unknown) => ({
      id,
      threadId: "thread-1",
      seq,
      role: "user",
      blocks: [{ kind: "text", text: id }],
      botId: null,
      authorUserId,
      replyToMessageId: replyTo ? "first" : null,
      replyQuote: null,
      replyTo: replyTo ?? null,
      runId: null,
      createdAt: new Date("2026-10-22T00:00:00.000Z"),
    });
    const first = row("first", 1, "user-a");
    const rows = [
      row("gone", 3, "user-deleted"),
      row("reply", 2, "user-b", { ...first, threadId: "thread-1" }),
      first,
    ];
    const users = vi.fn(async (_args: unknown) => [
      { id: "user-a", name: "Ana" },
      { id: "user-b", name: "Bea" },
    ]);
    const prisma = {
      message: { findMany: vi.fn(async () => rows) },
      user: { findMany: users },
    } as unknown as PrismaClient;

    const page = await loadMessagePage(prisma, "thread-1", undefined, 3);

    expect(users).toHaveBeenCalledTimes(1);
    expect(users.mock.calls[0]?.[0]).toEqual({
      where: { id: { in: expect.arrayContaining(["user-deleted", "user-b", "user-a"]) } },
      select: { id: true, name: true },
    });
    const byId = new Map(page.messages.map((message) => [message.id, message]));
    expect(byId.get("first")?.author).toEqual({ id: "user-a", name: "Ana" });
    expect(byId.get("reply")?.author).toEqual({ id: "user-b", name: "Bea" });
    expect(byId.get("reply")?.replyPreview?.author).toEqual({ id: "user-a", name: "Ana" });
    expect(byId.get("gone")).not.toHaveProperty("author");
  });

  it("queries before the cursor and returns an ascending bounded page", async () => {
    const findMany = vi.fn(async () =>
      [5, 4, 3].map((seq) => ({
        id: `message-${seq}`,
        threadId: "thread-1",
        seq,
        role: "bot",
        blocks: [{ kind: "text", text: String(seq) }],
        runId: null,
        createdAt: new Date(`2026-08-16T00:00:0${seq}.000Z`),
      })),
    );
    const prisma = { message: { findMany } } as unknown as PrismaClient;

    const page = await loadMessagePage(prisma, "thread-1", 6, 2);

    expect(findMany).toHaveBeenCalledWith({
      include: {
        replyTo: {
          select: { threadId: true, role: true, botId: true, authorUserId: true, blocks: true },
        },
      },
      where: { threadId: "thread-1", seq: { lt: 6 } },
      orderBy: { seq: "desc" },
      take: 3,
    });
    expect(page.messages.map((message) => message.seq)).toEqual([4, 5]);
    expect(page.olderCursor).toBe(4);
  });

  it("ends pagination when the database returns no lookahead row", async () => {
    const findMany = vi.fn(async () => [
      {
        id: "message-0",
        threadId: "thread-1",
        seq: 0,
        role: "user",
        blocks: [],
        runId: null,
        createdAt: new Date("2026-08-16T00:00:00.000Z"),
      },
    ]);
    const prisma = { message: { findMany } } as unknown as PrismaClient;

    const page = await loadMessagePage(prisma, "thread-1", 1, 2);

    expect(page.messages.map((message) => message.seq)).toEqual([0]);
    expect(page.olderCursor).toBeNull();
  });

  it("loads a page around a target sequence", async () => {
    const findFirst = vi.fn(async () => ({ seq: 5 }));
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: "message-3",
          threadId: "thread-1",
          seq: 3,
          role: "bot",
          blocks: [],
          runId: null,
          createdAt: new Date(),
        },
        {
          id: "message-4",
          threadId: "thread-1",
          seq: 4,
          role: "bot",
          blocks: [],
          runId: null,
          createdAt: new Date(),
        },
        {
          id: "message-5",
          threadId: "thread-1",
          seq: 5,
          role: "bot",
          blocks: [],
          runId: null,
          createdAt: new Date(),
        },
      ])
      .mockResolvedValueOnce(1);
    const count = vi.fn(async () => 1);
    const prisma = {
      message: { findFirst, findMany, count },
    } as unknown as PrismaClient;

    const page = await loadMessagePage(prisma, "thread-1", undefined, 4, { seq: 5 });

    expect(page.messages.map((message) => message.seq)).toEqual([3, 4, 5]);
    expect(page.olderCursor).toBe(3);
    expect(page.coveredThroughSeq).toBe(7);
    expect(findMany).toHaveBeenCalledWith({
      include: {
        replyTo: {
          select: { threadId: true, role: true, botId: true, authorUserId: true, blocks: true },
        },
      },
      where: { threadId: "thread-1", seq: { gte: 3, lte: 7 } },
      orderBy: { seq: "asc" },
      take: 4,
    });
  });

  it("collects bounded pages into chronological export order", async () => {
    const row = (seq: number) => ({
      id: `message-${seq}`,
      threadId: "thread-1",
      seq,
      role: "bot",
      blocks: [],
      runId: null,
      createdAt: new Date("2026-08-16T00:00:00.000Z"),
    });
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([row(4), row(3), row(2)])
      .mockResolvedValueOnce([row(2), row(1), row(0)])
      .mockResolvedValueOnce([row(0)]);
    const prisma = { message: { findMany } } as unknown as PrismaClient;

    const messages = await loadAllMessages(prisma, "thread-1", 2);

    expect(messages.map((message) => message.seq)).toEqual([0, 1, 2, 3, 4]);
    expect(findMany.mock.calls.map(([query]) => query.where.seq?.lt)).toEqual([undefined, 3, 1]);
  });
});

describe("authoritative reply previews", () => {
  it("serializes a parent outside the loaded page and marks deleted parents unavailable", async () => {
    const base = {
      threadId: "thread-1",
      role: "user",
      botId: null,
      runId: null,
      createdAt: new Date(),
      blocks: [{ kind: "text", text: "My reply" }],
    };
    const parent = {
      threadId: "thread-1",
      role: "bot",
      botId: "bot-1",
      blocks: [{ kind: "text", text: "**First** line\n\nSecond line" }],
    };
    const findMany = vi.fn().mockResolvedValue([
      {
        ...base,
        id: "reply-2",
        seq: 2,
        replyToMessageId: null,
        replyQuote: "First line",
        replyTo: null,
      },
      {
        ...base,
        id: "reply-1",
        seq: 1,
        replyToMessageId: "older-parent",
        replyQuote: null,
        replyTo: parent,
      },
    ]);
    const page = await loadMessagePage(
      { message: { findMany } } as unknown as PrismaClient,
      "thread-1",
      undefined,
      100,
    );
    expect(page.messages[0]?.replyPreview).toEqual({
      role: "bot",
      botId: "bot-1",
      text: "First line",
    });
    expect(page.messages[1]?.replyPreview).toBeNull();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { threadId: "thread-1" },
        include: {
          replyTo: {
            select: { threadId: true, role: true, botId: true, authorUserId: true, blocks: true },
          },
        },
      }),
    );
  });
  it("does not expose a parent from another thread", async () => {
    const row = {
      id: "reply",
      threadId: "thread-1",
      seq: 1,
      role: "user",
      blocks: [],
      botId: null,
      runId: null,
      createdAt: new Date(),
      replyToMessageId: "foreign",
      replyQuote: null,
      replyTo: {
        threadId: "other",
        role: "bot",
        botId: "other-bot",
        blocks: [{ kind: "text", text: "Private text" }],
      },
    };
    const page = await loadMessagePage(
      { message: { findMany: vi.fn().mockResolvedValue([row]) } } as unknown as PrismaClient,
      "thread-1",
      undefined,
      100,
    );
    expect(page.messages[0]?.replyPreview).toBeNull();
    expect(JSON.stringify(page)).not.toContain("Private text");
  });
});

describe("reply target validation", () => {
  it.each([
    ["malformed text", [{ kind: "text", text: 12 }], null],
    ["null block", [null], null],
    ["non-array", {}, null],
    ["ask", [{ kind: "ask", text: "Which release?" }], "Which release?"],
    [
      "chart",
      [{ kind: "chart", name: "Release adoption", spec: {}, data: [] }],
      "Release adoption",
    ],
  ])("serializes an outside-page %s target safely", async (_kind, blocks, text) => {
    const row = {
      id: "reply",
      threadId: "thread-1",
      seq: 100,
      role: "user",
      blocks: [{ kind: "text", text: "Follow up" }],
      botId: null,
      runId: null,
      createdAt: new Date("2026-10-08T12:00:00Z"),
      replyToMessageId: "older-parent",
      replyQuote: null,
      replyTo: { id: "older-parent", threadId: "thread-1", role: "bot", botId: "bot-1", blocks },
    };
    const prisma = {
      message: { findMany: vi.fn().mockResolvedValue([row]), count: vi.fn().mockResolvedValue(0) },
    } as unknown as PrismaClient;
    for (const around of [undefined, { seq: 100 }]) {
      const page = await loadMessagePage(prisma, "thread-1", undefined, 1, around);
      expect(page.messages.map((message) => message.id)).toEqual(["reply"]);
      expect(page.messages[0]?.replyPreview).toEqual(
        text === null ? null : { role: "bot", botId: "bot-1", text },
      );
    }
  });
});

it("derives attachment metadata from a validated parent outside the loaded page", async () => {
  const image = { kind: "image", artifactId: "parent-photo", name: "", mimeType: "image/png" };
  const row = {
    id: "reply",
    threadId: "thread",
    seq: 100,
    role: "user",
    blocks: [],
    botId: null,
    runId: null,
    createdAt: new Date(),
    replyToMessageId: "parent",
    replyQuote: null,
    replyTo: { threadId: "thread", role: "user", botId: null, blocks: [image] },
  };
  const prisma = {
    message: { findMany: vi.fn().mockResolvedValue([row]), count: vi.fn().mockResolvedValue(0) },
  } as unknown as PrismaClient;
  const page = await loadMessagePage(prisma, "thread", undefined, 1);
  expect(page.messages[0]?.replyPreview).toEqual({ role: "user", text: "", attachment: image });
});
