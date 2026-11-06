import type * as DbModule from "@labradoodle/db";
import { RunHistoryWriteError } from "@labradoodle/db";
import { expect, it, vi } from "vitest";
import type * as ComputerLifecycleModule from "./computer-lifecycle.js";
import { createRunExecutor } from "./executor.js";

const leases = vi.hoisted(() => ({
  acquire: vi.fn(),
  dedicated: vi.fn(),
  release: vi.fn(),
}));

const settleTakeoverCards = vi.hoisted(() => vi.fn());

vi.mock("@labradoodle/db", async (importOriginal) => ({
  ...(await importOriginal<typeof DbModule>()),
  settleReleasedTakeoverCards: settleTakeoverCards,
}));

vi.mock("./computer-lifecycle.js", async (importOriginal) => ({
  ...(await importOriginal<typeof ComputerLifecycleModule>()),
  acquireComputerExecutionLease: leases.acquire,
  acquireDedicatedScreenLeaseFence: leases.dedicated,
  releaseComputerExecutionLease: leases.release,
}));

function fixture(
  options: {
    startedAt?: Date;
    switching?: boolean;
    dedicated?: boolean;
    heldBy?: string;
    checkpoint?: string;
  } = {},
) {
  const run = {
    id: "run-1",
    botId: "bot-1",
    status: "queued",
    leaseFence: 0,
    checkpoint: options.checkpoint ?? null,
    startedAt: options.startedAt ?? null,
  };
  const prisma = {
    user: { findUnique: vi.fn(async () => null) },
    computer: { findUnique: async () => null },
    deploymentSettings: { findUnique: async () => null },
    threadMember: {
      findMany: async () => [{ userId: "user-1" }],
      findFirst: async () => ({ id: "member-1" }),
      findUnique: async () => ({ id: "member-1" }),
      count: async () => 1,
    },
    run: {
      findUnique: vi.fn(async () => run),
      findUniqueOrThrow: vi.fn(async () => ({ ...run, status: "leased" })),
      updateMany: vi.fn(async (_args: { data: { startedAt?: Date } }) => ({
        count: 1,
      })),
    },
    bot: {
      findUniqueOrThrow: vi.fn(async () => ({
        computerId: "computer-1",
        computerSwitching: options.switching ?? false,
        computer: { scope: options.dedicated ? "dedicated" : "team" },
      })),
    },
    computerExecutionLease: {
      findFirst: vi.fn(async () => (options.heldBy ? { id: options.heldBy } : null)),
    },
    // Stop at attempt setup so the fixture exercises only the real startup path.
    attempt: {
      create: vi.fn(async () => Promise.reject(new Error("attempt setup failed"))),
    },
  };
  const enqueue = vi.fn(async () => undefined);
  const executor = createRunExecutor({
    prisma,
    jobs: { enqueue },
  } as unknown as Parameters<typeof createRunExecutor>[0]);
  return {
    prisma,
    enqueue,
    start: () => executor.continueRun("run-1", "worker-1"),
  };
}

it("stops a superseded claim before it settles the new attempt's takeover cards", async () => {
  vi.clearAllMocks();
  settleTakeoverCards.mockRejectedValue(new RunHistoryWriteError());
  const { prisma, start } = fixture({ checkpoint: "takeover-skipped" });
  await start();
  expect(settleTakeoverCards).toHaveBeenCalledWith(
    prisma,
    expect.objectContaining({ runId: "run-1", lease: { owner: "worker-1", fence: 1 } }),
    expect.any(Function),
  );
  expect(leases.acquire).not.toHaveBeenCalled();
  expect(prisma.attempt.create).not.toHaveBeenCalled();
});
