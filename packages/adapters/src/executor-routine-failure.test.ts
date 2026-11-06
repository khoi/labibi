import type { NotificationMessage } from "@labradoodle/adapter-kit";
import {
  ModelAccountError,
  SandboxAllowanceUsedError,
  SandboxRateLimitError,
  TransientModelError,
} from "@labradoodle/adapter-kit";
import type * as DbModule from "@labradoodle/db";
import { countUnreadInboxChats } from "@labradoodle/db";
import { createLogger, createTestSink, installLogger } from "@labradoodle/logging";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as ComputerLifecycleModule from "./computer-lifecycle.js";
import { createRunExecutor } from "./executor.js";

vi.mock("./computer-lifecycle.js", async (importOriginal) => ({
  ...(await importOriginal<typeof ComputerLifecycleModule>()),
  acquireComputerExecutionLease: async () => null,
  acquireDedicatedScreenLeaseFence: async () => null,
  provisionComputer: async () => ({ id: "computer-1", kind: "desktop" }),
}));

vi.mock("@labradoodle/db", async (importOriginal) => ({
  ...(await importOriginal<typeof DbModule>()),
  countUnreadInboxChats: vi.fn(),
}));

const NOW = new Date("2026-03-02T09:00:00.000Z");
const MINUTE = 60_000;

interface Scenario {
  error: Error;
  trigger?: string;
  retryOfRunId?: string | null;
  routineNotify?: boolean;
  notifyOnFinish?: boolean;
  nextRunAt?: Date | null;
  toolCalls?: number;
  botMessages?: number;
  retryEnqueueFails?: boolean;
  unreadChats?: number;
  badgeFails?: boolean;
  switchToBackup?: { provider: string; modelId: string };
  personalKey?: boolean;
  pinnedTo?: { provider: string; modelId: string };
  clientNonce?: string;
  lateSince?: Date;
  startedAt?: Date;
  resumeAfterScheduleEdit?: boolean;
  lateLookupFails?: boolean;
  setupFailsOnce?: boolean;
}

async function failRun(scenario: Scenario) {
  vi.mocked(countUnreadInboxChats).mockImplementation(async () => {
    if (scenario.badgeFails) throw new Error("count unavailable");
    return scenario.unreadChats ?? 0;
  });
  const trigger = scenario.trigger ?? "routine";
  const run = {
    id: "run-1",
    botId: "bot-1",
    threadId: "thread-1",
    taskId: "task-1",
    spaceId: "space-1",
    userId: "user-1",
    status: "queued",
    trigger,
    routineId: trigger === "routine" ? "routine-1" : null,
    retryOfRunId: scenario.retryOfRunId ?? null,
    clientNonce: scenario.clientNonce ?? null,
    lateSince: scenario.lateSince ?? null,
    leaseFence: 0,
    startedAt: scenario.startedAt ?? null,
    ...(scenario.pinnedTo
      ? {
          modelPinned: true,
          modelProvider: scenario.pinnedTo.provider,
          modelId: scenario.pinnedTo.modelId,
        }
      : {}),
  };
  const queuedRow = { ...run };
  const runtimeRun = vi.fn(async function* (request: {
    onModelChange?: (provider: string, modelId: string) => Promise<void>;
  }) {
    if (scenario.resumeAfterScheduleEdit && runtimeRun.mock.calls.length === 1) {
      yield { type: "ask" as const, text: "Continue?" };
      return;
    }
    const backup = scenario.switchToBackup;
    if (backup) await request.onModelChange?.(backup.provider, backup.modelId);
    throw scenario.error;
  });
  const prisma = {
    threadMember: {
      findMany: async () => [{ userId: "user-1" }],
      findFirst: async () => ({ id: "member-1" }),
      findUnique: async () => ({ id: "member-1" }),
      count: async () => 1,
    },
    user: { findUnique: vi.fn(async () => null) },
    run: {
      findUnique: vi.fn(async () => run),
      findUniqueOrThrow: vi.fn(async () => ({ ...run })),
      findFirst: vi.fn(async () => ({
        bot: {
          id: "bot-1",
          name: "Assistant",
          color: "blue",
          notifyOnFinish: scenario.notifyOnFinish ?? true,
        },
        thread: { doodle: true },
      })),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        // Prisma leaves a field unchanged when its value is undefined.
        for (const [key, value] of Object.entries(data))
          if (value !== undefined) Object.assign(run, { [key]: value });
        return { count: 1 };
      }),
    },
    routine: {
      findUnique: vi.fn(async ({ select }: { select?: { crons?: boolean } }) => {
        if (scenario.lateLookupFails && select?.crons) throw new Error("lookup unavailable");
        return {
          crons:
            scenario.resumeAfterScheduleEdit && runtimeRun.mock.calls.length === 0
              ? ["0 * * * *"]
              : ["0 8 * * *"],
          timezone: "UTC",
          notify: scenario.routineNotify ?? true,
          nextRunAt:
            scenario.nextRunAt === undefined
              ? new Date(NOW.getTime() + 24 * 60 * MINUTE)
              : scenario.nextRunAt,
        };
      }),
    },
    chatGroup: { findMany: vi.fn(async () => []) },
    event: { count: vi.fn(async () => scenario.toolCalls ?? 0) },
    bot: {
      findUniqueOrThrow: vi.fn(async () => ({
        id: run.botId,
        name: "Assistant",
        title: "Assistant",
        description: "Test assistant",
        modelProvider: null,
        modelId: null,
        thinkingLevel: null,
        computerId: "computer-1",
        computerSwitching: false,
        memoryScope: null,
        computer: { id: "computer-1", scope: "dedicated" },
      })),
      findMany: vi.fn(async () => []),
    },
    attempt: {
      create: vi.fn(async () => ({ id: "attempt-1" })),
      update: vi.fn(),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    thread: {
      findUniqueOrThrow: vi.fn(async () => ({
        id: run.threadId,
        _count: { members: 1 },
        historyCompactionSummary: null,
        historyCompactedUpToSeq: null,
        nextMessageSeq: 1,
      })),
    },
    message: {
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
      count: vi.fn(async () => scenario.botMessages ?? 0),
    },
    task: {
      findUniqueOrThrow: vi.fn(async () => {
        if (scenario.setupFailsOnce && prisma.task.findUniqueOrThrow.mock.calls.length === 1)
          throw Object.assign(new Error("too many connections"), { code: "53300" });
        return { id: run.taskId, prompt: "Sweep the inbox" };
      }),
    },
    computer: {
      findUnique: async () => ({
        id: "computer-1",
        spaceId: "space-1",
        userId: "user-1",
        kind: "fake",
        homeKey: "home-1",
      }),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    connection: { findMany: vi.fn(async () => []) },
    userModelPreference: { findFirst: vi.fn(async () => null) },
    userModelRoleChoice: {
      findMany: vi.fn(async ({ where }: { where: { role: string } }) =>
        where.role !== "main"
          ? []
          : scenario.personalKey
            ? [
                {
                  provider: "openrouter",
                  modelId: "deepseek/deepseek-v4-flash-0731",
                  credentialId: "personal",
                  position: 0,
                  thinkingLevel: null,
                },
              ]
            : scenario.switchToBackup
              ? [{ ...scenario.switchToBackup, position: 1, thinkingLevel: null }]
              : [],
      ),
    },
    secret: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () =>
        scenario.personalKey ? { id: "personal-secret", ciphertext: "fixture-ciphertext" } : null,
      ),
    },
    userModelCredential: {
      findFirst: vi.fn(async () =>
        scenario.personalKey
          ? {
              id: "personal",
              provider: "openrouter",
              secretId: "personal-secret",
              userPreferences: [],
            }
          : null,
      ),
    },
    deploymentSettings: {
      findUnique: vi.fn(async () => ({
        defaultModelProvider: "openrouter",
        defaultModelId: "deepseek/deepseek-v4-flash-0731",
      })),
    },
    taughtSkill: { findMany: vi.fn(async () => []) },
    vaultCredential: { findMany: vi.fn(async () => []) },
    agentSkill: { findMany: vi.fn(async () => []) },
    externalEffect: { findMany: vi.fn(async () => []) },
    artifact: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async () => null),
  };
  const finalizeRun = vi.fn(async () => ({ continuationRunId: null }));
  const enqueue = vi.fn(async (job: { name: string }) => {
    if (job.name === "routine.retry" && scenario.retryEnqueueFails) throw new Error("queue down");
  });
  const send = vi.fn(async (_message: NotificationMessage, _context: unknown) => undefined);
  const executor = createRunExecutor({
    prisma,
    deploymentModelKey: "fake-deployment-key",
    secretStore: { load: vi.fn(async () => "fixture-personal-key"), put: vi.fn() },
    runtime: { describe: () => ({ capabilities: { scripted: false } }), run: runtimeRun },
    sandbox: {
      describe: () => ({ capabilities: { graphical: false } }),
      writeFile: vi.fn(async () => undefined),
      async *exportWorkspace() {
        yield* [];
      },
    },
    home: { commit: vi.fn(async () => "fixture-revision") },
    memory: { read: async () => ({ documents: [] }) },
    memoryProviders: { resolve: async () => null },
    artifacts: { get: vi.fn() },
    events: {
      append: vi.fn(async () => undefined),
      finalizeRun,
      pauseRunForInput: vi.fn(async () => {
        run.status = "waiting_input";
        return { continuationRunId: null };
      }),
    },
    jobs: { enqueue },
    notifications: { send },
    secrets: [],
  } as unknown as Parameters<typeof createRunExecutor>[0]);

  await executor.continueRun(run.id, "worker-1");
  if (scenario.setupFailsOnce) {
    expect(run.status).toBe("queued");
    expect(runtimeRun).not.toHaveBeenCalled();
    // The retry's job read the row before the first attempt stamped it, so only the row read
    // after the claim carries the first start.
    prisma.run.findUnique.mockResolvedValueOnce({ ...queuedRow });
    await executor.continueRun(run.id, "worker-1");
  }
  if (scenario.resumeAfterScheduleEdit) {
    expect(run.status).toBe("waiting_input");
    expect(run.startedAt).toEqual(NOW);
    expect(run.lateSince).toBeNull();
    await executor.continueRun(run.id, "worker-1");
  }
  expect(finalizeRun).toHaveBeenCalledWith(
    expect.objectContaining({
      outcome: "failed",
      error: scenario.pinnedTo ? "Connect that model provider first" : scenario.error.message,
    }),
  );
  const retries = enqueue.mock.calls
    .map(([job]) => job)
    .filter((job) => job.name === "routine.retry");
  return { retries, send, prisma, runtimeRun, run };
}

const overloaded = () =>
  new TransientModelError("Our servers are currently overloaded. Please try again later.");

beforeEach(() => {
  vi.mocked(countUnreadInboxChats).mockReset().mockResolvedValue(0);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("routine failure notifications", () => {
  it("puts the unread chats across the user's Spaces on the app icon", async () => {
    const { send, prisma } = await failRun({ error: new Error("Invalid API key"), unreadChats: 3 });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "failure", badge: 3 }),
      expect.anything(),
    );
    expect(countUnreadInboxChats).toHaveBeenCalledWith(prisma, {
      spaceId: "space-1",
      userId: "user-1",
    });
  });

  it("still sends without a badge when counting fails", async () => {
    const { send } = await failRun({ error: new Error("Invalid API key"), badgeFails: true });
    expect(send).toHaveBeenCalled();
    expect(send.mock.calls[0]?.[0]).not.toHaveProperty("badge");
  });

  it("stays quiet about a failed routine that turned notifications off", async () => {
    const { send } = await failRun({
      error: new Error("Invalid API key"),
      routineNotify: false,
      notifyOnFinish: true,
    });

    expect(send).not.toHaveBeenCalled();
  });
});

describe("a scheduled run that starts late", () => {
  const timer = (scheduledFor: string) => `routine-timer:routine-1:${scheduledFor}`;
  const lateWrites = (prisma: Awaited<ReturnType<typeof failRun>>["prisma"]) =>
    prisma.run.updateMany.mock.calls.filter(([args]) => args.data.lateSince !== undefined);
  const prompt = (runtimeRun: Awaited<ReturnType<typeof failRun>>["runtimeRun"]) =>
    (runtimeRun.mock.calls[0]?.[0] as { prompt?: string } | undefined)?.prompt ?? "";

  it("records the occurrence it was due at once, and tells the agent", async () => {
    // Created for Saturday's 08:00 while the host was down; starts Monday at 09:00.
    const { prisma, runtimeRun } = await failRun({
      error: new Error("Invalid API key"),
      clientNonce: timer("2026-02-28T08:00:00.000Z"),
    });
    expect(lateWrites(prisma)).toEqual([
      [
        expect.objectContaining({
          data: { startedAt: NOW, lateSince: new Date("2026-03-02T08:00:00.000Z") },
        }),
      ],
    ]);
    expect(prompt(runtimeRun)).toContain("it was due Monday, 2026-03-02 08:00");
  });

  it("keeps the classification and the note when the first attempt's setup fails", async () => {
    const { prisma, runtimeRun, run } = await failRun({
      error: new Error("Invalid API key"),
      clientNonce: timer("2026-02-28T08:00:00.000Z"),
      setupFailsOnce: true,
    });
    expect(lateWrites(prisma)).toHaveLength(1);
    expect(run.lateSince).toEqual(new Date("2026-03-02T08:00:00.000Z"));
    expect(runtimeRun).toHaveBeenCalledOnce();
    expect(prompt(runtimeRun)).toContain("it was due Monday, 2026-03-02 08:00");
  });

  it("does not reclassify an on-time run after input and a schedule edit", async () => {
    const { prisma, runtimeRun, run } = await failRun({
      error: new Error("Invalid API key"),
      clientNonce: timer("2026-03-02T08:00:00.000Z"),
      resumeAfterScheduleEdit: true,
    });
    expect(runtimeRun).toHaveBeenCalledTimes(2);
    expect(lateWrites(prisma)).toEqual([]);
    expect(run.lateSince).toBeNull();
  });

  it("leaves an already-started legacy null row unlabelled", async () => {
    const { prisma, run } = await failRun({
      error: new Error("Invalid API key"),
      clientNonce: timer("2026-02-28T08:00:00.000Z"),
      startedAt: new Date("2026-03-02T08:50:00.000Z"),
    });
    expect(lateWrites(prisma)).toEqual([]);
    expect(run.lateSince).toBeNull();
  });

  it("still runs and follows its normal outcome when the lateness lookup rejects", async () => {
    const { prisma, runtimeRun, run, send } = await failRun({
      error: new Error("Invalid API key"),
      clientNonce: timer("2026-02-28T08:00:00.000Z"),
      lateLookupFails: true,
    });
    expect(lateWrites(prisma)).toEqual([]);
    expect(runtimeRun).toHaveBeenCalledOnce();
    expect(run.startedAt).toEqual(NOW);
    expect(run.lateSince).toBeNull();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "failure" }),
      expect.anything(),
    );
  });

  it("keeps the recorded time when a late run resumes, and records nothing for an on-time run", async () => {
    const resumed = await failRun({
      error: new Error("Invalid API key"),
      clientNonce: timer("2026-02-28T08:00:00.000Z"),
      lateSince: new Date("2026-03-01T08:00:00.000Z"),
      startedAt: new Date("2026-03-01T09:00:00.000Z"),
    });
    expect(lateWrites(resumed.prisma)).toEqual([]);
    expect(resumed.run.startedAt).toEqual(new Date("2026-03-01T09:00:00.000Z"));
    expect(prompt(resumed.runtimeRun)).toContain("it was due Sunday, 2026-03-01 08:00");
    expect(prompt(resumed.runtimeRun)).toContain("started Sunday, 2026-03-01 09:00");
    const onTime = await failRun({
      error: new Error("Invalid API key"),
      clientNonce: timer("2026-03-02T08:50:00.000Z"),
    });
    expect(lateWrites(onTime.prisma)).toEqual([]);
    expect(prompt(onTime.runtimeRun)).not.toContain("started late");
  });
});

describe("retrying a routine run after a transient model failure", () => {
  it("schedules one retry and holds the failure notice", async () => {
    const { retries, send } = await failRun({ error: overloaded() });

    expect(retries).toEqual([
      {
        name: "routine.retry",
        payload: { runId: "run-1" },
        availableAt: new Date(NOW.getTime() + 12 * MINUTE),
        replaceKey: "routine.retry:run-1",
      },
    ]);
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ["a permanent error", { error: new Error("Invalid API key") }],
    ["a run that was already a retry", { error: overloaded(), retryOfRunId: "run-0" }],
    ["a run that called a tool", { error: overloaded(), toolCalls: 1 }],
    ["a run that posted a message", { error: overloaded(), botMessages: 1 }],
    [
      "a run whose next occurrence is near",
      { error: overloaded(), nextRunAt: new Date(NOW.getTime() + 40 * MINUTE) },
    ],
  ] satisfies Array<[string, Scenario]>)(
    "does not retry %s and notifies instead",
    async (_label, scenario) => {
      const { retries, send } = await failRun(scenario);

      expect(retries).toEqual([]);
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "failure" }),
        expect.anything(),
      );
    },
  );

  it("notifies when the retry cannot be queued", async () => {
    const { send } = await failRun({ error: overloaded(), retryEnqueueFails: true });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "failure" }),
      expect.anything(),
    );
  });

  it("does not schedule a routine retry for a chat run", async () => {
    const { retries } = await failRun({ error: overloaded(), trigger: "user" });

    expect(retries).toEqual([]);
  });
});

describe("backing off a routine after its model connection refuses it", () => {
  const refusedKey = () =>
    new ModelAccountError('401: {"error":{"message":"Invalid API key","code":401}}');

  it("counts a refusal of the user's own key", async () => {
    const { prisma } = await failRun({ error: refusedKey(), personalKey: true });

    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });

  it("counts a run pinned to a provider the user has no connection for", async () => {
    const { prisma } = await failRun({
      error: refusedKey(),
      pinnedTo: { provider: "anthropic", modelId: "claude-sonnet-4-5" },
    });

    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });

  it("counts a daily quota that resets hours from now, without a quick retry", async () => {
    const message = `429 ${JSON.stringify({
      error: {
        message: "Rate limit exceeded: free-models-per-day",
        code: 429,
        metadata: { headers: { "X-RateLimit-Reset": String(NOW.getTime() + 10 * 60 * MINUTE) } },
      },
    })}`;
    const { prisma, retries } = await failRun({
      error: new ModelAccountError(message),
      personalKey: true,
    });

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(retries).toEqual([]);
  });

  it("counts a spent computer allowance, without a quick retry", async () => {
    const { prisma, retries } = await failRun({ error: new SandboxAllowanceUsedError() });

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(retries).toEqual([]);
  });

  it.each([
    ["the deployment's own key", { error: refusedKey() }],
    [
      "a rate limit",
      {
        error: new ModelAccountError('429: {"error":{"message":"Rate limit reached"}}'),
        personalKey: true,
      },
    ],
    ["a transient failure", { error: overloaded(), personalKey: true }],
    ["a chat run", { error: refusedKey(), personalKey: true, trigger: "user" }],
  ] satisfies Array<[string, Scenario]>)("does not count %s", async (_label, scenario) => {
    const { prisma } = await failRun(scenario);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

interface RetryScenario {
  status?: string;
  retryOfRunId?: string | null;
  active?: boolean;
  oneShot?: boolean;
  archived?: boolean;
  nextRunAt?: Date | null;
  laterRun?: boolean;
  laterRunBeforeCreate?: boolean;
  duplicate?: boolean;
  enqueueFails?: boolean;
  routineNotify?: boolean;
  missingRoutine?: boolean;
  routineOwner?: string;
  missingTask?: boolean;
  pausedBeforeCreate?: boolean;
  archivedBeforeCreate?: boolean;
  invalidDestination?: boolean;
  retryStartedBeforeCleanup?: boolean;
}

function retryHarness(scenario: RetryScenario = {}) {
  vi.mocked(countUnreadInboxChats).mockResolvedValue(1);
  const failedAt = new Date(NOW.getTime() - 12 * MINUTE);
  const failed = {
    id: "run-1",
    spaceId: "space-1",
    botId: "bot-1",
    threadId: "thread-1",
    taskId: "task-1",
    userId: "user-1",
    status: scenario.status ?? "failed",
    trigger: "routine",
    routineId: "routine-1",
    retryOfRunId: scenario.retryOfRunId ?? null,
    modelProvider: "routine-provider",
    modelId: "routine-model",
    thinkingLevel: "low",
    modelPinned: true,
    createdAt: failedAt,
    error: overloaded().message,
  };
  const tx = {
    routine: {
      updateMany: vi.fn(async () => ({
        count: scenario.pausedBeforeCreate || scenario.archivedBeforeCreate ? 0 : 1,
      })),
    },
    thread: {
      findFirst: vi.fn(async () => (scenario.invalidDestination ? null : { id: "thread-1" })),
    },
    task: {
      create: vi.fn(async () => ({ id: "task-2" })),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    run: {
      findFirst: vi.fn(async () => (scenario.laterRunBeforeCreate ? { id: "run-later" } : null)),
      deleteMany: vi.fn(async () => ({ count: scenario.retryStartedBeforeCleanup ? 0 : 1 })),
      create: vi.fn(async () => {
        if (scenario.duplicate) {
          throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        }
        return { id: "run-2", taskId: "task-2" };
      }),
    },
  };
  const prisma = {
    threadMember: {
      findFirst: async () => ({ id: "member-1" }),
      findUnique: async () => ({ id: "member-1" }),
      count: async () => 1,
    },
    user: { findUnique: vi.fn(async () => null) },
    run: {
      findUnique: vi.fn(async () => failed),
      findFirst: vi.fn(async ({ select }: { select: { id?: boolean } }) =>
        select.id
          ? scenario.laterRun ||
            (scenario.laterRunBeforeCreate && prisma.$transaction.mock.calls.length > 0)
            ? { id: "run-later" }
            : null
          : {
              bot: {
                id: "bot-1",
                name: "Assistant",
                color: "blue",
                notifyOnFinish: true,
              },
              thread: { doodle: true },
            },
      ),
    },
    routine: {
      findUnique: vi.fn(async () =>
        scenario.missingRoutine
          ? null
          : {
              notify: scenario.routineNotify ?? true,
              active: scenario.active ?? true,
              userId: scenario.routineOwner ?? "user-1",
              crons: scenario.oneShot ? ["@once"] : ["0 9 * * *"],
              nextRunAt:
                scenario.nextRunAt === undefined
                  ? new Date(NOW.getTime() + 24 * 60 * MINUTE)
                  : scenario.nextRunAt,
              bot: { archivedAt: scenario.archived ? failedAt : null },
            },
      ),
    },
    task: {
      findUnique: vi.fn(async () => (scenario.missingTask ? null : { prompt: "Sweep the inbox" })),
    },
    $transaction: vi.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx)),
    bot: { findUniqueOrThrow: vi.fn(async () => ({ name: "Assistant" })) },
  };
  const enqueue = vi.fn(async () => {
    if (scenario.enqueueFails) throw new Error("queue down");
  });
  const send = vi.fn(async (_message: NotificationMessage, _context: unknown) => undefined);
  const executor = createRunExecutor({
    prisma,
    jobs: { enqueue },
    notifications: { send },
  } as unknown as Parameters<typeof createRunExecutor>[0]);
  return { executor, prisma, tx, enqueue, send };
}

describe("running a routine retry", () => {
  it("respects the routine's notification preference when a paused retry is abandoned", async () => {
    const { executor, send } = retryHarness({ active: false, routineNotify: false });

    await executor.retryRoutineRun("run-1");

    expect(send).not.toHaveBeenCalled();
  });
});

describe("exhausted routine retry notification", () => {
  it("does not notify when a later run of the routine exists", async () => {
    const { executor, send } = retryHarness({ laterRun: true });

    await executor.notifyRoutineRetryAttemptsExhausted("run-1");

    expect(send).not.toHaveBeenCalled();
  });

  it("respects the routine's notification preference", async () => {
    const { executor, send } = retryHarness({ routineNotify: false });

    await executor.notifyRoutineRetryAttemptsExhausted("run-1");

    expect(send).not.toHaveBeenCalled();
  });

  it("ignores a missing original run", async () => {
    const { executor, prisma, send } = retryHarness();
    prisma.run.findUnique.mockResolvedValueOnce(null as never);

    await executor.notifyRoutineRetryAttemptsExhausted("run-1");

    expect(send).not.toHaveBeenCalled();
  });

  it.each([{ status: "completed" }, { retryOfRunId: "run-0" }])(
    "ignores an ineligible original run: %s",
    async (scenario) => {
      const { executor, send } = retryHarness(scenario);

      await executor.notifyRoutineRetryAttemptsExhausted("run-1");

      expect(send).not.toHaveBeenCalled();
    },
  );
});

describe("reporting a failed run", () => {
  afterEach(() => {
    installLogger(createLogger({ service: "test", level: "off", sinks: [] }));
  });

  async function failedRunLog(error: Error, scenario: Partial<Scenario> = {}) {
    const sink = createTestSink();
    installLogger(createLogger({ service: "test", sinks: [sink] }));
    await failRun({ ...scenario, error, trigger: "user" });
    return sink.events.filter((event) => event.message === "run.failed");
  }

  it.each([
    ["a provider outage that outlasted its retries", overloaded()],
    ["a rejected model key", new ModelAccountError('401: {"message":"Invalid API-key provided."}')],
    ["the computer provider's rate limit", new SandboxRateLimitError()],
  ])("logs %s as a warning, not an error report", async (_label, error) => {
    expect(await failedRunLog(error)).toEqual([
      expect.objectContaining({ level: "warn", "run.failure": error.name, reason: error.message }),
    ]);
  });

  it("reports any other failure as an error", async () => {
    expect(await failedRunLog(new Error("Unexpected message role"))).toEqual([
      expect.objectContaining({ level: "error" }),
    ]);
  });

  it.each([
    ["warning", overloaded()],
    ["error", new Error("Unexpected message role")],
  ])("names the model that failed on the %s", async (_level, error) => {
    const events = await failedRunLog(error);
    expect(events).toEqual([
      expect.objectContaining({
        "model.provider": "openrouter",
        "model.id": "deepseek/deepseek-v4-flash-0731",
      }),
    ]);
  });

  it.each([
    ["warning", overloaded()],
    ["error", new Error("Unexpected message role")],
  ])(
    "names the backup model that failed on the %s, without its endpoint or key",
    async (_level, error) => {
      const events = await failedRunLog(error, {
        switchToBackup: { provider: "openai-compatible", modelId: "local-model" },
      });
      expect(events).toEqual([
        expect.objectContaining({
          "model.provider": "openai-compatible",
          "model.id": "local-model",
        }),
      ]);
      const fields = events.map(({ error: _stack, ...rest }) => rest);
      expect(JSON.stringify(fields)).not.toMatch(/fake-deployment-key|:\/\//);
    },
  );
});
