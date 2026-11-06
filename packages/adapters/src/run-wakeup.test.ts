import type { BackgroundJobHandlers, JobPublisher } from "@labradoodle/adapter-kit";
import { runContinueJob } from "@labradoodle/adapter-kit";
import type { PrismaClient } from "@labradoodle/db";
import { currentDbContext } from "@labradoodle/db";
import { createLogger, createTestSink, installLogger } from "@labradoodle/logging";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryRealtimeFanout } from "./realtime.js";
import { RunExecutionHost } from "./run-execution.js";
import { RunJobPublisher, RunStarter, RunWorkerHost, withRunWorker } from "./run-wakeup.js";

afterEach(() => vi.useRealTimers());

function fixture() {
  const rows = new Map<string, { status: string; wakeAt: Date | null; trigger?: string }>();
  const updateMany = vi.fn(async ({ where, data }) => {
    const row = rows.get(where.id);
    if (!row || !where.status.in.includes(row.status) || (where.wakeAt === null && row.wakeAt))
      return { count: 0 };
    Object.assign(row, data);
    return { count: 1 };
  });
  const findMany = vi.fn(
    async (args: { where: { trigger: { in?: string[]; notIn?: string[] } } }) =>
      [...rows]
        .filter(
          ([, row]) =>
            row.status === "queued" &&
            (!row.wakeAt || row.wakeAt.getTime() <= Date.now()) &&
            (args.where.trigger.in
              ? args.where.trigger.in.includes(row.trigger ?? "user")
              : !args.where.trigger.notIn!.includes(row.trigger ?? "user")),
        )
        .map(([id]) => ({ id, botId: id, bot: { computerId: "computer" } })),
  );
  const leases = vi.fn(
    async () => [] as { computerId: string; botId: string; runId: string; expiresAt: Date }[],
  );
  const queueHealth = vi.fn(async () => [
    { delayedRuns: 0, oldestDueAt: null as Date | null, oldestRunId: null as string | null },
  ]);
  const prisma = {
    run: { updateMany, findMany },
    $queryRaw: queueHealth,
    computerExecutionLease: { findMany: leases },
  } as unknown as PrismaClient;
  const realtime = new InMemoryRealtimeFanout();
  const background = {
    enqueue: vi.fn(),
    cancel: vi.fn(),
    close: vi.fn(),
  } as unknown as JobPublisher;
  const starter = new RunStarter(realtime);
  const publisher = new RunJobPublisher(prisma, background, starter);
  const host = new RunWorkerHost(prisma, realtime, starter, { intervalMs: 100 });
  return {
    rows,
    prisma,
    realtime,
    background,
    starter,
    publisher,
    host,
    findMany,
    updateMany,
    leases,
    queueHealth,
  };
}

describe("durable direct run wakeups", () => {
  it("reports unstarted runs as an error with process health, and their recovery", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const sink = createTestSink();
    installLogger(createLogger({ service: "test", sinks: [sink] }));
    f.queueHealth.mockResolvedValue([
      { delayedRuns: 2, oldestDueAt: new Date(Date.now() - 60_000), oldestRunId: "stuck" },
    ]);
    try {
      await f.host.start({} as BackgroundJobHandlers);
      await vi.advanceTimersByTimeAsync(1);
      const delayed = sink.events.filter((event) => event.message === "run.queue_delayed");
      expect(delayed).toHaveLength(1);
      expect(delayed[0]).toMatchObject({
        level: "error",
        "queue.delayed_runs": 2,
        "queue.oldest_run_id": "stuck",
        "worker.active_runs": 0,
      });
      expect(delayed[0]!["event_loop.delay_max_ms"]).toEqual(expect.any(Number));
      await vi.advanceTimersByTimeAsync(29_000);
      expect(f.queueHealth).toHaveBeenCalledTimes(1);
      f.queueHealth.mockResolvedValue([{ delayedRuns: 0, oldestDueAt: null, oldestRunId: null }]);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(sink.events.filter((event) => event.message === "run.queue_recovered")).toHaveLength(
        1,
      );
    } finally {
      await f.host.stop();
      installLogger(createLogger({ service: "test", level: "off", sinks: [] }));
    }
  });

  it("starts chat without invoking Graphile, deduplicates wakeups, and drains long executions", async () => {
    const f = fixture();
    f.rows.set("chat", { status: "queued", wakeAt: null });
    let release!: () => void;
    const done = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handler = vi.fn(async ({ runId }, execution) => {
      expect(currentDbContext()?.kind).toBe("system");
      f.rows.get(runId)!.status = "running";
      execution.onRunStarted();
      await done;
    });
    try {
      await f.host.start({ "run.continue": handler } as unknown as BackgroundJobHandlers);
      await f.publisher.enqueue(runContinueJob("chat"));
      await f.publisher.enqueue(runContinueJob("chat"));
      await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
      expect(f.background.enqueue).not.toHaveBeenCalled();
      let stopped = false;
      const stopping = f.host.stop().then(() => {
        stopped = true;
      });
      await Promise.resolve();
      expect(stopped).toBe(false);
      release();
      await stopping;
    } finally {
      release();
      await f.host.stop();
    }
  });

  it("leaves schedules and maintenance with the background scheduler", async () => {
    const f = fixture();
    const job = { name: "routine.retry", payload: { runId: "routine" } } as const;
    await f.publisher.enqueue(job);
    expect(f.background.enqueue).toHaveBeenCalledExactlyOnceWith(job);
    expect(f.updateMany).not.toHaveBeenCalled();
  });

  it("can restart after notification subscription fails", async () => {
    const f = fixture();
    vi.spyOn(f.realtime, "subscribe").mockRejectedValueOnce(new Error("fixture subscribe failure"));
    const target = { "run.continue": vi.fn() } as unknown as BackgroundJobHandlers;
    await expect(f.host.start(target)).rejects.toThrow("fixture subscribe failure");
    try {
      await f.host.start(target);
      await vi.waitFor(() => expect(f.findMany).toHaveBeenCalled());
    } finally {
      await f.host.stop();
    }
  });

  it("keeps direct dispatch running while background startup waits for database capacity", async () => {
    const runs = { start: vi.fn(), stop: vi.fn() } as unknown as RunWorkerHost;
    const background = {
      start: vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error("fixture scheduler unavailable"), { code: "53300" }),
        ),
      stop: vi.fn(),
    };
    await expect(
      withRunWorker(runs, background).start({} as BackgroundJobHandlers),
    ).rejects.toThrow("fixture scheduler unavailable");
    expect(runs.start).toHaveBeenCalledOnce();
    expect(runs.stop).not.toHaveBeenCalled();
  });
  it("drains direct runs before propagating a fatal scheduler startup failure", async () => {
    let release!: () => void;
    const drain = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runs = { start: vi.fn(), stop: vi.fn(() => drain) } as unknown as RunWorkerHost;
    const background = {
      start: vi.fn().mockRejectedValue(new Error("fatal fixture startup")),
      stop: vi.fn(),
    };
    let rejected = false;
    const starting = withRunWorker(runs, background)
      .start({} as BackgroundJobHandlers)
      .catch(() => {
        rejected = true;
      });
    await vi.waitFor(() => expect(runs.stop).toHaveBeenCalledOnce());
    expect(rejected).toBe(false);
    release();
    await starting;
    expect(rejected).toBe(true);
  });

  it("waits for an in-flight scheduler start before finishing shutdown", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runs = { start: vi.fn(), stop: vi.fn() } as unknown as RunWorkerHost;
    const background = { start: vi.fn(() => pending), stop: vi.fn() };
    const host = withRunWorker(runs, background);
    const starting = host.start({} as BackgroundJobHandlers);
    await vi.waitFor(() => expect(background.start).toHaveBeenCalledOnce());
    let stopped = false;
    const stopping = host.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(runs.stop).toHaveBeenCalledOnce();
    expect(stopped).toBe(false);
    release();
    await starting;
    await stopping;
    expect(stopped).toBe(true);
    expect(background.stop).toHaveBeenCalledTimes(2);
  });

  it("starts a run in the process that makes it due, with no scan or notification", async () => {
    const f = fixture();
    f.rows.set("chat", { status: "queued", wakeAt: null });
    const publish = vi.spyOn(f.realtime, "publish");
    const handler = vi.fn(async ({ runId }) => {
      f.rows.get(runId)!.status = "completed";
    });
    try {
      f.starter.attach({ "run.continue": handler } as unknown as BackgroundJobHandlers);
      await f.publisher.enqueue(runContinueJob("chat"));
      await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
      expect(f.findMany).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalled();
      expect(f.background.enqueue).not.toHaveBeenCalled();
    } finally {
      await f.starter.stop();
    }
  });

  it("never holds one run's start behind another run, however slow", async () => {
    const f = fixture();
    let release!: () => void;
    const stuck = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered: string[] = [];
    try {
      f.starter.attach({
        "run.continue": async ({ runId }: { runId: string }) => {
          entered.push(runId);
          if (runId === "stuck") await stuck;
        },
      } as unknown as BackgroundJobHandlers);
      await f.publisher.enqueue(runContinueJob("stuck"));
      for (let index = 0; index < 20; index += 1) {
        await f.publisher.enqueue(runContinueJob(`chat-${index}`));
      }
      await vi.waitFor(() => expect(entered).toHaveLength(21));
    } finally {
      release();
      await f.starter.stop();
    }
  });

  it("starts a delayed run on time without a scan", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.rows.set("retry", { status: "queued", wakeAt: null });
    const handler = vi.fn();
    try {
      f.starter.attach({ "run.continue": handler } as unknown as BackgroundJobHandlers);
      await f.publisher.enqueue({
        ...runContinueJob("retry"),
        availableAt: new Date(Date.now() + 1_000),
      });
      await vi.advanceTimersByTimeAsync(900);
      expect(handler).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(200);
      expect(handler).toHaveBeenCalledOnce();
      expect(f.findMany).not.toHaveBeenCalled();
    } finally {
      await f.starter.stop();
    }
  });

  it("hands a run to a running worker when its own process is stopping", async () => {
    const f = fixture();
    f.rows.set("handed", { status: "queued", wakeAt: null });
    const stopping = new AbortController();
    stopping.abort();
    const leaving = new RunStarter(f.realtime, { signal: stopping.signal });
    const leavingHandler = vi.fn();
    leaving.attach({ "run.continue": leavingHandler } as unknown as BackgroundJobHandlers);
    const handler = vi.fn(async ({ runId }) => {
      f.rows.get(runId)!.status = "completed";
    });
    try {
      await f.host.start({ "run.continue": handler } as unknown as BackgroundJobHandlers);
      await new RunJobPublisher(f.prisma, f.background, leaving).enqueue(runContinueJob("handed"));
      await vi.waitFor(() =>
        expect(handler).toHaveBeenCalledWith({ runId: "handed" }, expect.anything()),
      );
      expect(leavingHandler).not.toHaveBeenCalled();
    } finally {
      await leaving.stop();
      await f.host.stop();
    }
  });

  it("does not hand a taken run back and forth when this process cannot run it", async () => {
    const f = fixture();
    const publish = vi.spyOn(f.realtime, "publish");
    const admission = vi.spyOn(RunExecutionHost.prototype, "execute").mockResolvedValue(false);
    try {
      await f.host.start({ "run.continue": vi.fn() } as unknown as BackgroundJobHandlers);
      await f.publisher.enqueue(runContinueJob("full"));
      await vi.waitFor(() => expect(publish).toHaveBeenCalledOnce());
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(publish).toHaveBeenCalledOnce();
    } finally {
      admission.mockRestore();
      await f.host.stop();
    }
  });

  it("starts a run again when it is made due while this process is still finishing it", async () => {
    const f = fixture();
    let release!: () => void;
    const finishing = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handler = vi.fn(async () => {
      if (handler.mock.calls.length === 1) await finishing;
    });
    try {
      f.starter.attach({ "run.continue": handler } as unknown as BackgroundJobHandlers);
      await f.publisher.enqueue(runContinueJob("answered"));
      await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
      await f.publisher.enqueue(runContinueJob("answered"));
      await f.publisher.enqueue(runContinueJob("answered"));
      release();
      await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(2));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(handler).toHaveBeenCalledTimes(2);
    } finally {
      release();
      await f.starter.stop();
    }
  });
});
