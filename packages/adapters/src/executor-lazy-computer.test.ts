import type { AgentRunRequest, ComputerRef } from "@labradoodle/adapter-kit";
import { SandboxUnresponsiveError } from "@labradoodle/adapter-kit";
import type { MessageBlock } from "@labradoodle/contracts";
import { createLogger, createTestSink, installLogger } from "@labradoodle/logging";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as ComputerLifecycleModule from "./computer-lifecycle.js";
import { createRunExecutor } from "./executor.js";

const sink = createTestSink();

const provisionComputer = vi.hoisted(() => vi.fn());

vi.mock("./computer-lifecycle.js", async (importOriginal) => ({
  ...(await importOriginal<typeof ComputerLifecycleModule>()),
  acquireComputerExecutionLease: async () => null,
  acquireDedicatedScreenLeaseFence: async () => null,
  provisionComputer,
}));

const COMPUTER: ComputerRef = {
  id: "sandbox-1",
  botId: "home-1",
  kind: "e2b",
  providerRef: "sandbox-1",
};

/** A routine run whose model makes the given tool calls, then answers. */
async function runRoutine(
  toolCalls: Array<{ name: string; args: Record<string, unknown> }>,
  options: {
    takeover?: boolean;
    takeoverReleased?: boolean;
    native?: boolean;
    nativeUnavailable?: boolean;
    toolFailure?: "abort" | "recover";
    attachments?: "file" | "image";
    steering?: boolean;
    steeringAfterFirst?: boolean;
    copyFailureOnce?: boolean;
    parallel?: boolean;
    priorSetupFailures?: number;
    exportError?: Error;
    setupError?: Error;
    shutdownSignal?: AbortSignal;
    /** User stop already flipped the run to cancelled before the turn ends. */
    cancelRun?: boolean;
    onRunStarted?: () => void;
  } = {},
) {
  const attachment: Extract<MessageBlock, { kind: "file" | "image" }> = {
    kind: options.attachments ?? "file",
    artifactId: "artifact-1",
    name: "private-upload.png",
    mimeType: options.attachments === "image" ? "image/png" : "text/plain",
    size: 4,
  };
  const run = {
    id: "run-1",
    botId: "bot-1",
    threadId: "thread-1",
    taskId: "task-1",
    spaceId: "space-1",
    userId: "user-1",
    status: "queued" as string,
    trigger: options.attachments && !options.steering ? "user" : "routine",
    sourceMessageId: options.attachments && !options.steering ? "message-1" : null,
    routineId: "routine-1",
    retryOfRunId: null,
    leaseOwner: null as string | null,
    leaseFence: 0,
    leaseExpiresAt: null as Date | null,
    wakeAt: null as Date | null,
  };
  const toolResults: unknown[] = [];
  const steeringInputs: unknown[] = [];
  // A test-owned signal cannot be aborted mid-run, so the runtime fake trips this
  // relay; the executor still sees the option's signal through AbortSignal.any.
  const shutdownRelay = new AbortController();
  const runtimeRun = vi.fn(async function* (request: AgentRunRequest) {
    if (options.cancelRun) run.status = "cancelled";
    if (options.steering && !options.steeringAfterFirst) {
      steeringInputs.push(...((await request.claimSteering?.([])) ?? []));
    }
    const execute = async (call: (typeof toolCalls)[number], index: number) => {
      try {
        toolResults.push(await request.executeTool?.(call.name, call.args, `exec-${index}`));
      } catch (error) {
        if (!options.toolFailure) throw error;
      }
      if (index === 0 && options.steeringAfterFirst) {
        steeringInputs.push(...((await request.claimSteering?.([])) ?? []));
      }
      if (options.toolFailure === "abort") {
        // Shutdown lands while the tool call is in flight, so the runtime aborts.
        shutdownRelay.abort();
        throw new DOMException("Aborted", "AbortError");
      }
    };
    if (options.parallel) await Promise.all(toolCalls.map(execute));
    else for (const [index, call] of toolCalls.entries()) await execute(call, index);
    // Shutdown lands mid-turn, yet the stream still ends without an exception.
    shutdownRelay.abort();
    if (options.takeover) {
      yield { type: "takeover" as const, reason: "Sign in to the inbox." };
      return;
    }
    yield { type: "text-delta" as const, text: "Inbox is clear." };
    yield { type: "done" as const, text: "Inbox is clear." };
  });
  const prisma = {
    threadMember: {
      findMany: async () => [{ userId: "user-1" }],
      findFirst: async () => ({ id: "member-1" }),
      findUnique: async () => ({ id: "member-1" }),
      count: async () => 1,
    },
    run: {
      findUnique: vi.fn(async () => run),
      findUniqueOrThrow: vi.fn(async () => run),
      // No other run of this bot waits for the computer.
      findFirst: vi.fn(async (args?: { where?: { status?: unknown } }) =>
        args?.where?.status === "queued" ? null : { thread: {} },
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where?: { status?: unknown; leaseOwner?: unknown; leaseFence?: unknown };
          data: Record<string, unknown>;
        }) => {
          // Honor the lease fence the executor uses to avoid releasing a run it no longer owns.
          if (typeof where?.status === "string" && where.status !== run.status) return { count: 0 };
          if (typeof where?.leaseOwner === "string" && where.leaseOwner !== run.leaseOwner)
            return { count: 0 };
          if (typeof where?.leaseFence === "number" && where.leaseFence !== run.leaseFence)
            return { count: 0 };
          Object.assign(run, data);
          return { count: 1 };
        },
      ),
    },
    routine: { findUnique: vi.fn(async () => ({ notify: false, nextRunAt: null })) },
    event: { count: vi.fn(async () => 0) },
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
        computer: {
          id: "computer-1",
          scope: "dedicated",
          kind: options.native ? "desktop" : "e2b",
          homeKey: "home-1",
        },
      })),
      findUnique: vi.fn(async () => ({ name: "Assistant" })),
      findMany: vi.fn(async () => []),
    },
    attempt: {
      create: vi.fn(async () => ({ id: "attempt-1" })),
      findMany: vi.fn(async () =>
        Array.from({ length: options.priorSetupFailures ?? 0 }, () => ({
          status: "setup_failed",
          error: "Run setup failed; retrying",
        })),
      ),
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
      findMany: vi.fn(async () =>
        options.attachments && !options.steering
          ? [
              {
                id: "message-1",
                role: "user",
                runId: run.id,
                seq: 1,
                blocks: [attachment],
                steeringMessages: [],
              },
            ]
          : [],
      ),
      findUnique: vi.fn(async () => null),
      findFirst: vi.fn(async () => null),
      count: vi.fn(async () => 0),
    },
    task: { findUniqueOrThrow: vi.fn(async () => ({ id: run.taskId, prompt: "Sweep the inbox" })) },
    computer: {
      findUnique: async () => null,
      updateMany: vi.fn(async () => ({ count: 1 })),
      findFirst: vi.fn(async () => ({
        state: "running",
        restorePending: false,
        screenGeneration: 0,
      })),
    },
    connection: { findMany: vi.fn(async () => []) },
    userModelPreference: { findFirst: vi.fn(async () => null) },
    secret: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
    userModelCredential: { findFirst: vi.fn(async () => null) },
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
    artifact: {
      findMany: vi.fn(async () =>
        options.attachments
          ? [
              {
                id: "artifact-1",
                storageKey: "private-storage-key",
                name: attachment.name,
                mimeType: attachment.mimeType,
                size: 4,
              },
            ]
          : [],
      ),
    },
  };
  const sandbox = {
    describe: () => ({ id: "e2b", capabilities: { graphical: false } }),
    environment: options.native
      ? vi.fn(async () => {
          if (options.nativeUnavailable) throw new Error("native app is closed");
          return { platform: "win32", home: "C:\\Users\\example", shell: "powershell.exe" };
        })
      : undefined,
    listFiles: vi.fn(async () => [{ path: "notes.txt", kind: "file", size: 4 }]),
    writeFile: vi.fn(async () => undefined),
    releaseScreen: vi.fn(async () => undefined),
    exportWorkspace: vi.fn(async function* () {
      if (options.exportError) throw options.exportError;
      yield* [];
    }),
  };
  if (options.copyFailureOnce)
    sandbox.writeFile.mockRejectedValueOnce(new Error("temporary copy failure"));
  const finalizeRun = vi.fn(async () => ({ continuationRunId: null }));
  const enqueue = vi.fn(async () => undefined);
  const events = {
    append: vi.fn(async () => undefined),
    claimSteering: vi.fn(async () => [
      { id: "steering-1", messageId: "message-2", text: "Look at this", blocks: [attachment] },
    ]),
    finalizeRun,
    pauseRunForTakeover: vi.fn(async () =>
      options.takeoverReleased ? { continuationRunId: run.id } : false,
    ),
  };
  const executorInput = {
    prisma: withEmptyModels(prisma),
    deploymentModelKey: "fake-deployment-key",
    runtime: { describe: () => ({ capabilities: { scripted: false } }), run: runtimeRun },
    sandbox,
    home: { commit: vi.fn(async () => "fixture-revision") },
    memory: { read: async () => ({ documents: [] }) },
    memoryProviders: {
      resolve: async () => {
        if (options.setupError) throw options.setupError;
        return null;
      },
    },
    artifacts: { get: vi.fn(async () => new Uint8Array([1, 2, 3, 4])) },
    events,
    jobs: { enqueue },
    notifications: { send: vi.fn(async () => undefined) },
    secrets: [],
    shutdownSignal: options.shutdownSignal
      ? AbortSignal.any([options.shutdownSignal, shutdownRelay.signal])
      : undefined,
  };
  const executor = createRunExecutor(
    executorInput as unknown as Parameters<typeof createRunExecutor>[0],
  );

  await executor.continueRun(
    run.id,
    "worker-1",
    options.onRunStarted
      ? () => {
          expect(run.status).toBe("running");
          options.onRunStarted!();
        }
      : undefined,
  );
  const sleepJobs = enqueue.mock.calls
    .map((call) => (call as unknown[])[0] as { name: string })
    .filter((job) => job.name === "computer.sleep");
  const resumeOnNextWorker = async () => {
    const resumedRuntime = vi.fn(async function* () {
      yield { type: "text-delta" as const, text: "Resumed." };
      yield { type: "done" as const, text: "Resumed." };
    });
    const resumedFinalize = vi.fn(async () => ({ continuationRunId: null }));
    const resumed = createRunExecutor({
      ...(executorInput as object),
      runtime: { describe: () => ({ capabilities: { scripted: false } }), run: resumedRuntime },
      events: { ...events, finalizeRun: resumedFinalize },
      shutdownSignal: undefined,
    } as unknown as Parameters<typeof createRunExecutor>[0]);
    await resumed.continueRun(run.id, "worker-2");
    return { runtimeRun: resumedRuntime, finalizeRun: resumedFinalize };
  };
  return {
    finalizeRun,
    sandbox,
    sleepJobs,
    toolResults,
    enqueue,
    runtimeRun,
    steeringInputs,
    prisma,
    run,
    resumeOnNextWorker,
  };
}

beforeEach(() => {
  sink.events.length = 0;
  installLogger(createLogger({ service: "test", sinks: [sink] }));
  provisionComputer.mockReset();
  provisionComputer.mockResolvedValue(COMPUTER);
});

afterEach(() => {
  vi.clearAllMocks();
  installLogger(createLogger({ service: "test", level: "off", sinks: [] }));
});

describe("run computer provisioning", () => {
  it("retries handed-off setup failures with durable attempt accounting and backoff", async () => {
    const onRunStarted = vi.fn();
    const { run, enqueue, runtimeRun, prisma } = await runRoutine([], {
      setupError: new Error("fixture setup outage"),
      onRunStarted,
    });
    expect(onRunStarted).toHaveBeenCalledExactlyOnceWith();
    expect(runtimeRun).not.toHaveBeenCalled();
    expect(run.status).toBe("queued");
    expect(prisma.attempt.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "setup_failed" }),
      }),
    );
    expect(enqueue).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        name: "run.continue",
        payload: { runId: run.id },
        availableAt: expect.any(Date),
      }),
    );
  });

  it("spreads retries over minutes while the computer provider is down", async () => {
    // Every clock read moves on a millisecond, so two separate reads would disagree.
    let clock = Date.now();
    const now = vi.spyOn(Date, "now").mockImplementation(() => (clock += 1));
    try {
      const before = Date.now();
      const { run, enqueue } = await runRoutine([], {
        setupError: new SandboxUnresponsiveError("Boat could not be reached"),
        onRunStarted: vi.fn(),
        priorSetupFailures: 2,
      });

      const [[job]] = enqueue.mock.calls as unknown as [[{ availableAt: Date }]];
      expect(job.availableAt.getTime() - before).toBeGreaterThanOrEqual(60_000);
      expect(job.availableAt.getTime() - Date.now()).toBeLessThanOrEqual(60_000);
      expect(run.wakeAt).toEqual(job.availableAt);
    } finally {
      now.mockRestore();
    }
  });

  it("retains the setup-failure limit after handing off a run", async () => {
    const onRunStarted = vi.fn();
    const { enqueue, finalizeRun } = await runRoutine([], {
      setupError: new Error("fixture setup outage"),
      onRunStarted,
      priorSetupFailures: 7,
    });
    expect(onRunStarted).toHaveBeenCalledExactlyOnceWith();
    expect(finalizeRun).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failed" }));
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("never starts the computer for a run that does not use it", async () => {
    const { finalizeRun, sandbox, sleepJobs } = await runRoutine([]);

    expect(finalizeRun).toHaveBeenCalledWith(expect.objectContaining({ outcome: "completed" }));
    expect(provisionComputer).not.toHaveBeenCalled();
    expect(sandbox.releaseScreen).not.toHaveBeenCalled();
    expect(sleepJobs).toEqual([]);
  });

  it.each(["file", "image"] as const)(
    "keeps %s attachments lazy and images available to the model",
    async (attachments) => {
      const { finalizeRun, sandbox, runtimeRun } = await runRoutine([], { attachments });
      expect(finalizeRun).toHaveBeenCalledWith(expect.objectContaining({ outcome: "completed" }));
      expect(provisionComputer).not.toHaveBeenCalled();
      expect(sandbox.writeFile).not.toHaveBeenCalled();
      if (attachments === "image") {
        expect(runtimeRun.mock.calls[0]?.[0].currentTurnImages).toEqual([
          expect.objectContaining({ mimeType: "image/png", data: new Uint8Array([1, 2, 3, 4]) }),
        ]);
      }
      expect(sink.events).toContainEqual(
        expect.objectContaining({ message: "run.computer", reason: "none", ready: false }),
      );
      expect(JSON.stringify(sink.events)).not.toContain("private-upload");
      expect(JSON.stringify(sink.events)).not.toContain("private-storage-key");
    },
  );

  it("does not boot for a steering attachment without computer tools", async () => {
    await runRoutine([], { attachments: "image", steering: true });
    expect(provisionComputer).not.toHaveBeenCalled();
  });

  it("requeues a run aborted by shutdown so the next worker resumes it", async () => {
    const { finalizeRun, prisma, run, enqueue, resumeOnNextWorker } = await runRoutine(
      [{ name: "list_files", args: { path: "" } }],
      {
        toolFailure: "abort",
        shutdownSignal: new AbortController().signal,
      },
    );

    expect(finalizeRun).not.toHaveBeenCalled();
    expect(run).toMatchObject({
      status: "queued",
      leaseOwner: null,
      leaseExpiresAt: null,
      wakeAt: null,
    });
    expect(prisma.run.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "run-1",
          status: "running",
          leaseOwner: "worker-1",
        }),
        data: expect.objectContaining({ status: "queued", leaseOwner: null, leaseExpiresAt: null }),
      }),
    );
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ name: "run.continue", payload: { runId: "run-1" } }),
    );
    expect(prisma.attempt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "interrupted" }) }),
    );

    const resumed = await resumeOnNextWorker();
    expect(resumed.runtimeRun).toHaveBeenCalled();
    expect(resumed.finalizeRun).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "completed" }),
    );
  });

  it("requeues a run whose stream ends after shutdown instead of completing it", async () => {
    const { finalizeRun, prisma, run, enqueue } = await runRoutine([], {
      shutdownSignal: new AbortController().signal,
    });

    expect(finalizeRun).not.toHaveBeenCalled();
    expect(run.status).toBe("queued");
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ name: "run.continue", payload: { runId: "run-1" } }),
    );
    expect(prisma.attempt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "interrupted" }) }),
    );
  });

  it("does not claim a run when the worker is already shutting down", async () => {
    const shutdown = new AbortController();
    shutdown.abort();
    const { runtimeRun, run, enqueue, finalizeRun } = await runRoutine([], {
      shutdownSignal: shutdown.signal,
    });

    expect(runtimeRun).not.toHaveBeenCalled();
    expect(finalizeRun).not.toHaveBeenCalled();
    expect(run.status).toBe("queued");
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("requeues a run when shutdown lands before the model starts", async () => {
    const shutdown = new AbortController();
    const { runtimeRun, finalizeRun, run, enqueue } = await runRoutine([], {
      shutdownSignal: shutdown.signal,
      onRunStarted: () => shutdown.abort(),
    });

    expect(runtimeRun).not.toHaveBeenCalled();
    expect(finalizeRun).not.toHaveBeenCalled();
    expect(run).toMatchObject({ status: "queued", leaseOwner: null, leaseExpiresAt: null });
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ name: "run.continue", payload: { runId: "run-1" } }),
    );
  });

  it("leaves a user-stopped run cancelled", async () => {
    const { finalizeRun, run, enqueue } = await runRoutine([], { cancelRun: true });

    expect(finalizeRun).not.toHaveBeenCalled();
    expect(run.status).toBe("cancelled");
    expect(continueJobs(enqueue)).toEqual([]);
  });

  it("does not requeue a run the user stopped while the worker is shutting down", async () => {
    const { finalizeRun, run, enqueue } = await runRoutine([], {
      cancelRun: true,
      shutdownSignal: new AbortController().signal,
    });

    expect(finalizeRun).not.toHaveBeenCalled();
    expect(run.status).toBe("cancelled");
    expect(continueJobs(enqueue)).toEqual([]);
  });
});

function continueJobs(enqueue: { mock: { calls: unknown[][] } }) {
  return enqueue.mock.calls
    .map((call) => call[0] as { name?: string })
    .filter((job) => job?.name === "run.continue");
}

/** Models the run reads but these tests do not care about behave as empty tables. */
function withEmptyModels<T extends object>(prisma: T): T {
  const empty = {
    findMany: async () => [],
    findFirst: async () => null,
    findUnique: async () => null,
    count: async () => 0,
    updateMany: async () => ({ count: 0 }),
  };
  return new Proxy(prisma, {
    get: (target, key) => (key in target ? target[key as keyof T] : empty),
  });
}
