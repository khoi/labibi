import type { Actor } from "@labradoodle/contracts";
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "./client.js";
import { createRepos } from "./repos.js";

const actor: Actor = {
  userId: "user-1",
  spaceId: "ws-1",
  email: "test@example.com",
  isDeploymentOwner: false,
};

const baseBot = {
  id: "bot-1",
  spaceId: "ws-1",
  userId: "user-1",
  name: "Test Bot",
  title: "",
  instructions: "",
  color: "#000",
  notifyOnFinish: true,
  archivedAt: null,
  memoryScope: null as string | null,
  createdAt: new Date("2026-08-19T00:00:00.000Z"),
  updatedAt: new Date("2026-08-19T00:00:00.000Z"),
  thread: { id: "thread-1", unread: false, messages: [], runs: [] },
  runs: [],
  computer: null,
};

function reposFor(memoryScope: string | null) {
  const prisma = {
    bot: {
      findMany: vi.fn(async () => [{ ...baseBot, memoryScope }]),
    },
    run: {
      findMany: vi.fn(async () => []),
    },
    $queryRaw: vi.fn(async () => []),
  };
  return createRepos(prisma as unknown as PrismaClient);
}

describe("createRepos.listBots", () => {
  it("surfaces a failed foreground run and clears the signal after recovery", async () => {
    const findMany = vi.fn(async () => [baseBot]);
    const queryRaw = vi.fn(async () => [] as unknown[]);
    queryRaw.mockResolvedValueOnce([{ id: "run-failed", threadId: "thread-1", status: "failed" }]);
    const repos = createRepos({
      bot: { findMany },
      $queryRaw: queryRaw,
    } as unknown as PrismaClient);
    const failed = await repos.listBots(actor);
    expect(failed[0]).toMatchObject({ status: "idle", runErrorId: "run-failed" });
    queryRaw.mockResolvedValueOnce([
      { id: "run-recovered", threadId: "thread-1", status: "completed" },
    ]);
    const recovered = await repos.listBots(actor);
    expect(recovered[0]).toMatchObject({ status: "idle", runErrorId: null });
  });

  it("keeps bot-to-bot run output out of sidebar previews", async () => {
    const findMany = vi.fn(async () => [
      {
        ...baseBot,
        thread: { ...baseBot.thread, messages: [] },
      },
    ]);
    const prisma = {
      bot: {
        findMany,
      },
      run: {
        findMany: vi.fn(async () => [{ id: "run-peer" }]),
      },
      $queryRaw: vi.fn(async () => [
        {
          threadId: "thread-1",
          seq: 3,
          createdAt: new Date("2026-08-20T00:00:00.000Z"),
          runId: "run-peer",
          blocks: [{ kind: "text", text: "Echoed peer reply" }],
        },
        {
          threadId: "thread-1",
          seq: 2,
          createdAt: new Date("2026-08-19T00:00:00.000Z"),
          runId: "run-peer",
          blocks: [
            {
              kind: "bot_message_received",
              fromBotId: "bot-2",
              fromBotName: "Coder",
              text: "Peer result",
            },
          ],
        },
        {
          threadId: "thread-1",
          seq: 1,
          createdAt: new Date("2026-08-18T00:00:00.000Z"),
          runId: "run-user",
          blocks: [{ kind: "text", text: "Visible answer" }],
        },
      ]),
    };

    await expect(createRepos(prisma as unknown as PrismaClient).listBots(actor)).resolves.toEqual([
      expect.objectContaining({ preview: "Visible answer" }),
    ]);
  });

  it("skips a peer-run preview tail when the receipt is outside the window", async () => {
    const prisma = {
      bot: {
        findMany: vi.fn(async () => [
          {
            ...baseBot,
            thread: { ...baseBot.thread, messages: [] },
          },
        ]),
      },
      run: {
        findMany: vi.fn(async () => [{ id: "run-peer" }]),
      },
      $queryRaw: vi.fn(async () => [
        {
          threadId: "thread-1",
          seq: 2,
          createdAt: new Date("2026-08-20T00:00:00.000Z"),
          runId: "run-peer",
          blocks: [{ kind: "text", text: "Echoed peer reply" }],
        },
        {
          threadId: "thread-1",
          seq: 1,
          createdAt: new Date("2026-08-19T00:00:00.000Z"),
          runId: "run-user",
          blocks: [{ kind: "text", text: "Visible answer" }],
        },
      ]),
      message: {
        findMany: vi.fn(async () => []),
      },
    };

    await expect(createRepos(prisma as unknown as PrismaClient).listBots(actor)).resolves.toEqual([
      expect.objectContaining({ preview: "Visible answer" }),
    ]);
  });

  it("uses text from the same window after a chart-only peer relay", async () => {
    const messageFindMany = vi.fn(async () => [
      { seq: 1, blocks: [{ kind: "text", text: "Earlier-window answer" }] },
    ]);
    const prisma = {
      bot: { findMany: vi.fn(async () => [baseBot]) },
      run: { findMany: vi.fn(async () => [{ id: "run-peer", trigger: "bot_message" }]) },
      $queryRaw: vi.fn(async () => [
        {
          id: "chart-reply",
          threadId: "thread-1",
          seq: 4,
          role: "bot",
          runId: "run-peer",
          blocks: [{ kind: "chart", name: "Results", spec: {}, data: [] }],
        },
        {
          id: "relay-receipt",
          threadId: "thread-1",
          seq: 3,
          role: "bot",
          runId: "run-peer",
          replyToMessageId: "sent",
          blocks: [
            {
              kind: "bot_message_received",
              fromBotId: "bot-2",
              fromBotName: "Coder",
              text: "Peer result",
              intent: "result",
            },
          ],
        },
        {
          id: "answer",
          threadId: "thread-1",
          seq: 2,
          role: "bot",
          runId: null,
          blocks: [{ kind: "text", text: "Current-window answer" }],
        },
      ]),
      message: { findMany: messageFindMany },
    };

    await expect(createRepos(prisma as unknown as PrismaClient).listBots(actor)).resolves.toEqual([
      expect.objectContaining({ preview: "Current-window answer" }),
    ]);
    expect(messageFindMany).not.toHaveBeenCalled();
  });

  it("scans older messages when the newest window is only peer output", async () => {
    const messageFindMany = vi.fn(async () => [
      { seq: 1, runId: "run-user", blocks: [{ kind: "text", text: "Older visible answer" }] },
    ]);
    const prisma = {
      bot: {
        findMany: vi.fn(async () => [
          {
            ...baseBot,
            thread: { ...baseBot.thread, messages: [] },
          },
        ]),
      },
      run: {
        findMany: vi.fn(async () => [{ id: "run-peer" }]),
      },
      $queryRaw: vi.fn(async () => [
        {
          threadId: "thread-1",
          seq: 20,
          createdAt: new Date("2026-08-20T00:00:00.000Z"),
          runId: "run-peer",
          blocks: [{ kind: "text", text: "Echoed peer reply" }],
        },
      ]),
      message: {
        findMany: messageFindMany,
      },
    };

    await expect(createRepos(prisma as unknown as PrismaClient).listBots(actor)).resolves.toEqual([
      expect.objectContaining({ preview: "Older visible answer" }),
    ]);
    expect(messageFindMany).toHaveBeenCalledWith({
      where: { threadId: "thread-1", seq: { lt: 20 } },
      orderBy: { seq: "desc" },
      take: 16,
    });
  });

  it("uses a visible message from the fourth older window for preview", async () => {
    const peerWindows = [
      [{ seq: 80, runId: "run-peer", blocks: [{ kind: "text", text: "peer 80" }] }],
      [{ seq: 60, runId: "run-peer", blocks: [{ kind: "text", text: "peer 60" }] }],
      [{ seq: 40, runId: "run-peer", blocks: [{ kind: "text", text: "peer 40" }] }],
      [{ seq: 20, runId: "run-peer", blocks: [{ kind: "text", text: "peer 20" }] }],
      [{ seq: 1, runId: "run-user", blocks: [{ kind: "text", text: "Fourth-window answer" }] }],
    ];
    let windowIndex = 0;
    const messageFindMany = vi.fn(async () => {
      windowIndex += 1;
      return peerWindows[windowIndex] ?? [];
    });
    const prisma = {
      bot: {
        findMany: vi.fn(async () => [
          {
            ...baseBot,
            thread: { ...baseBot.thread, messages: [] },
          },
        ]),
      },
      run: {
        findMany: vi.fn(async () => [{ id: "run-peer" }]),
      },
      $queryRaw: vi.fn(async () =>
        (peerWindows[0] ?? []).map((message) => ({
          threadId: "thread-1",
          createdAt: new Date("2026-08-20T00:00:00.000Z"),
          ...message,
        })),
      ),
      message: {
        findMany: messageFindMany,
      },
    };

    await expect(createRepos(prisma as unknown as PrismaClient).listBots(actor)).resolves.toEqual([
      expect.objectContaining({ preview: "Fourth-window answer" }),
    ]);
    expect(messageFindMany).toHaveBeenCalledTimes(4);
  });

  it("dates the row by its newest message, not the bot's last settings write", async () => {
    const prisma = {
      bot: {
        findMany: vi.fn(async () => [
          {
            ...baseBot,
            updatedAt: new Date("2026-08-21T09:00:00.000Z"),
            thread: { ...baseBot.thread, messages: [] },
          },
        ]),
      },
      run: { findMany: vi.fn(async () => []) },
      $queryRaw: vi.fn(async () => [
        {
          threadId: "thread-1",
          seq: 2,
          createdAt: new Date("2026-08-20T10:30:00.000Z"),
          blocks: [{ kind: "text", text: "Latest answer" }],
        },
        {
          threadId: "thread-1",
          seq: 1,
          createdAt: new Date("2026-08-20T10:00:00.000Z"),
          blocks: [{ kind: "text", text: "Question" }],
        },
      ]),
    };

    await expect(createRepos(prisma as unknown as PrismaClient).listBots(actor)).resolves.toEqual([
      expect.objectContaining({ updatedAt: "2026-08-20T10:30:00.000Z" }),
    ]);
  });

  it("keeps the bot's own updatedAt for a chat with no messages", async () => {
    await expect(reposFor(null).listBots(actor)).resolves.toEqual([
      expect.objectContaining({ updatedAt: "2026-08-19T00:00:00.000Z" }),
    ]);
  });
});

describe("createRepos.listSpaceBotsForSpaces", () => {
  it("loads and maps only the compact cross-space sidebar fields", async () => {
    const findMany = vi.fn(async (_query: { where: unknown; select: Record<string, unknown> }) => [
      {
        id: "bot-2",
        spaceId: "ws-2",
        name: "Support",
        color: "#123456",
        notifyOnFinish: false,
        updatedAt: new Date("2026-08-20T00:00:00.000Z"),
        thread: {
          id: "thread-2",
          unread: true,
          runs: [{ id: "run-failed", status: "failed" }],
        },
        runs: [{ status: "running", threadId: "group-thread" }],
      },
    ]);
    const repos = createRepos({
      bot: { findMany },
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ id: "run-failed", threadId: "thread-2", status: "failed" }])
        .mockResolvedValueOnce([
          {
            id: "message-2",
            threadId: "thread-2",
            seq: 4,
            role: "user",
            blocks: [{ kind: "text", text: "Waiting for a reply" }],
            botId: null,
            replyToMessageId: null,
            replyQuote: null,
            runId: null,
            clientNonce: null,
            createdAt: new Date("2026-08-19T12:00:00.000Z"),
          },
        ]),
    } as unknown as PrismaClient);

    await expect(repos.listSpaceBotsForSpaces(["ws-2"])).resolves.toEqual([
      {
        id: "bot-2",
        spaceId: "ws-2",
        name: "Support",
        title: "",
        color: "#123456",
        notifyOnFinish: false,
        unread: true,
        preview: "Waiting for a reply",
        status: "running",
        threadStatus: "idle",
        runErrorId: "run-failed",
        updatedAt: "2026-08-19T12:00:00.000Z",
      },
    ]);
    const query = findMany.mock.calls[0]![0];
    expect(query.select.thread).toEqual(
      expect.objectContaining({
        select: expect.not.objectContaining({
          messages: expect.anything(),
        }),
      }),
    );
    expect(query.where).toEqual(expect.objectContaining({ spaceId: { in: ["ws-2"] } }));
    expect(query.select).not.toHaveProperty("instructions");
    expect(query.select).not.toHaveProperty("computer");
  });
});
