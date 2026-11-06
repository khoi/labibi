import type * as db from "@labradoodle/db";
import { describe, expect, it, vi } from "vitest";
import { queueMcpConnectedRun, resolveMcpApprovalCards } from "./mcp-approval.js";

vi.mock("@labradoodle/db", async (original) => ({
  ...(await original<typeof db>()),
  appendEventInTransaction: vi.fn(async () => ({ seq: 1 })),
}));

/** PostgreSQL jsonb `@>` containment, which Prisma `array_contains` compiles to. */

type MessageQuery = { where?: { blocks?: { array_contains?: unknown } } };

function fixture(blocks: unknown[]) {
  const tx = {
    message: {
      findMany: vi.fn(
        async (_query: MessageQuery): Promise<unknown[]> => [
          { id: "card-message", botId: "bot", blocks },
        ],
      ),
      update: vi.fn(),
    },
  };
  const deps = {
    prisma: {
      bot: { findFirst: vi.fn(async () => ({ id: "bot", thread: { id: "main-thread" } })) },
      thread: { findMany: vi.fn(async () => [{ id: "group-thread" }]) },
      mcpServer: { findFirst: vi.fn(async () => ({ id: "srv-a" })) },
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(tx)),
    },
    events: { notify: vi.fn() },
  } as unknown as Parameters<typeof resolveMcpApprovalCards>[0];
  const actor = {
    userId: "user",
    spaceId: "space",
    email: "user@rakazo.test",
    isDeploymentOwner: true,
  };
  return { deps, actor, tx };
}

describe("resolveMcpApprovalCards", () => {
  it("leaves a card for another member's server to that member", async () => {
    const blocks = [{ kind: "mcp_approval", name: "A", serverId: "srv-a", status: "pending" }];
    const { deps, actor, tx } = fixture(blocks);
    deps.prisma.mcpServer.findFirst = vi.fn(async () => null) as never;
    await resolveMcpApprovalCards(deps, actor, {
      botId: "bot",
      serverId: "srv-a",
      status: "dismissed",
      threadId: "group-thread",
    });
    expect(deps.prisma.mcpServer.findFirst).toHaveBeenCalledWith({
      where: { id: "srv-a", userId: "user" },
      select: { id: true },
    });
    expect(deps.prisma.thread.findMany).not.toHaveBeenCalled();
    expect(tx.message.update).not.toHaveBeenCalled();
  });
});

describe("queueMcpConnectedRun", () => {
  const actor = {
    userId: "user",
    spaceId: "space",
    email: "user@rakazo.test",
    isDeploymentOwner: true,
  };
  const input = { botId: "bot", serverId: "srv-a", threadId: "thread" };

  function connectedFixture(state: { thread?: boolean; busy?: boolean; archived?: boolean } = {}) {
    const tx = {
      bot: { findFirst: vi.fn(async () => (state.archived ? null : { id: "bot" })) },
      thread: { findFirst: vi.fn(async () => (state.thread === false ? null : { id: "thread" })) },
      run: {
        findFirst: vi.fn(async () => (state.busy ? { id: "active" } : null)),
        create: vi.fn(async () => ({ id: "run" })),
      },
      mcpServer: { findFirst: vi.fn(async () => ({ name: "Axiom" })) },
      task: { create: vi.fn(async () => ({ id: "task" })) },
    };
    return tx as typeof tx & Parameters<typeof queueMcpConnectedRun>[0];
  }

  it("queues a turn for the bot in the card's chat", async () => {
    const tx = connectedFixture();
    await expect(queueMcpConnectedRun(tx, actor, input)).resolves.toBe("run");
    expect(tx.task.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        botId: "bot",
        threadId: "thread",
        prompt: expect.stringContaining('"Axiom"'),
      }),
    });
    expect(tx.run.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ taskId: "task", trigger: "user", status: "queued" }),
      select: { id: true },
    });
  });

  it("does not queue while the bot is still busy in that chat", async () => {
    const tx = connectedFixture({ busy: true });
    await expect(queueMcpConnectedRun(tx, actor, input)).resolves.toBeNull();
    expect(tx.run.create).not.toHaveBeenCalled();
  });

  it("does not queue in a chat the bot is not part of", async () => {
    const tx = connectedFixture({ thread: false });
    await expect(queueMcpConnectedRun(tx, actor, input)).resolves.toBeNull();
    expect(tx.task.create).not.toHaveBeenCalled();
  });
});
