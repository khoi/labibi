import { createLogger, installLogger } from "@labradoodle/logging";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as ComputerLifecycleModule from "./computer-lifecycle.js";
import { replaceComputer } from "./computer-lifecycle.js";
import {
  performComputerUpdate,
  queueComputerUpdate,
  reconcileComputerUpdates,
} from "./computer-update.js";

vi.mock("./computer-lifecycle.js", async (original) => ({
  ...(await original<typeof ComputerLifecycleModule>()),
  replaceComputer: vi.fn(),
}));
const replacement = vi.mocked(replaceComputer);
afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  installLogger(createLogger({ service: "test", level: "off", sinks: [] }));
});
type Match = { status: string; updatedAt?: { lt: Date } };
type Where = Match | { OR: Match[] };
function fixture(status = "queued") {
  const row = {
    id: "update-1",
    computerId: "computer-1",
    botId: "bot-1",
    action: "update",
    status,
    stage: "preparing",
    updatedAt: new Date(0),
    computer: {
      id: "computer-1",
      kind: "fake",
      scope: "team",
      spaceId: "space",
      userId: "user",
      bots: [{ id: "bot-1", name: "Writer" }],
    },
  };
  const rows = [row];
  const computer = {
    updateMany: vi.fn(async () => ({ count: 1 })),
    findUniqueOrThrow: vi.fn(async () => row.computer),
  };
  const computerUpdate = {
    create: vi.fn(async () => row),
    findUniqueOrThrow: vi.fn(async () => row),
    findMany: vi.fn(async ({ where, take }: { where: Where; take: number }) =>
      rows
        .filter((each) =>
          ("OR" in where ? where.OR : [where]).some(
            (match) =>
              match.status === each.status &&
              (!match.updatedAt || each.updatedAt < match.updatedAt.lt),
          ),
        )
        .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
        .slice(0, take)
        .map((each) => ({ ...each })),
    ),
    updateMany: vi.fn(async ({ where, data }) => {
      const target = where.id ? rows.find((each) => each.id === where.id) : row;
      if (!target) return { count: 0 };
      if (
        where.status &&
        (typeof where.status === "string"
          ? where.status !== target.status
          : !where.status.in.includes(target.status))
      )
        return { count: 0 };
      if (where.updatedAt && where.updatedAt.getTime() !== target.updatedAt.getTime())
        return { count: 0 };
      Object.assign(target, data);
      return { count: 1 };
    }),
  };
  const prisma = {
    $queryRaw: vi.fn(async () => []),
    computer,
    bot: { findFirst: vi.fn(async () => ({ userId: "user" })) },
    computerUpdate,
    $transaction: vi.fn(async (fn) => fn(prisma)),
  };
  const jobs = { enqueue: vi.fn(async () => {}) };
  const deps = { prisma, jobs } as unknown as Parameters<typeof performComputerUpdate>[0];
  return { row, rows, computer, computerUpdate, deps, jobs };
}
describe("background computer maintenance", () => {
  it("checks the computer for idle sleep again after a failed update", async () => {
    const { row, deps, jobs } = fixture();
    replacement.mockRejectedValueOnce(new Error("checkpoint upload failed"));
    await performComputerUpdate(deps, row.id);
    expect(row.status).toBe("failed");
    expect(jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ replaceKey: `computer.sleep:${row.computerId}` }),
    );
  });
  it("republishes queued intent after an enqueue failure", async () => {
    const { row, deps, jobs } = fixture();
    jobs.enqueue.mockRejectedValueOnce(new Error("offline"));
    await queueComputerUpdate(deps, row.computerId, row.botId);
    await reconcileComputerUpdates(deps);
    expect(jobs.enqueue).toHaveBeenCalledTimes(2);
    expect(replacement).not.toHaveBeenCalled();
  });
  it("keeps an interrupted worker reserved instead of repeating a destructive step", async () => {
    const { row, deps, computer } = fixture("running");
    await reconcileComputerUpdates(deps);
    expect(row.status).toBe("interrupted");
    expect(computer.updateMany).not.toHaveBeenCalled();
    expect(replacement).not.toHaveBeenCalled();
  });
  it("frees a computer whose interrupted update never settled", async () => {
    const { row, deps, computer, jobs } = fixture("interrupted");
    row.updatedAt = new Date(Date.now() - 61 * 60_000);
    await reconcileComputerUpdates(deps);
    expect(row.status).toBe("failed");
    expect(computer.updateMany).toHaveBeenLastCalledWith({
      where: { id: row.computerId, maintenanceId: row.id },
      data: { maintenanceId: null },
    });
    expect(jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ replaceKey: `computer.sleep:${row.computerId}` }),
    );
  });
  it("keeps a recently interrupted update reserved", async () => {
    const { row, deps, computer, jobs } = fixture("interrupted");
    row.updatedAt = new Date(Date.now() - 59 * 60_000);
    await reconcileComputerUpdates(deps);
    expect(row.status).toBe("interrupted");
    expect(computer.updateMany).not.toHaveBeenCalled();
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });
  it("keeps the outcome of a worker that settles before the release", async () => {
    const { row, deps, computer, computerUpdate, jobs } = fixture("interrupted");
    row.updatedAt = new Date(Date.now() - 61 * 60_000);
    const select = computerUpdate.findMany.getMockImplementation();
    let selected = 0;
    computerUpdate.findMany.mockImplementation(async (args) => {
      const found = (await select?.(args)) ?? [];
      selected += found.length;
      if (found.length) Object.assign(row, { status: "completed", updatedAt: new Date() });
      return found;
    });
    await reconcileComputerUpdates(deps);
    expect(selected).toBe(1);
    expect(row.status).toBe("completed");
    expect(computer.updateMany).not.toHaveBeenCalled();
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it("reaches stale and abandoned updates behind a backlog of queued ones", async () => {
    const { row, rows, deps, jobs } = fixture("interrupted");
    row.updatedAt = new Date(Date.now() - 61 * 60_000);
    const reserving = { ...row, id: "update-2", status: "reserving", updatedAt: new Date(1) };
    rows.push(reserving);
    for (let i = 0; i < 101; i++)
      rows.push({ ...row, id: `queued-${i}`, status: "queued", updatedAt: new Date(0) });
    await reconcileComputerUpdates(deps);
    expect(row.status).toBe("failed");
    expect(reserving.status).toBe("failed");
    expect(jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ name: "computer.update", payload: { updateId: "queued-0" } }),
    );
  });

  it("frees an abandoned update even when republishing a queued one fails", async () => {
    const { row, rows, deps, jobs } = fixture("interrupted");
    row.updatedAt = new Date(Date.now() - 61 * 60_000);
    rows.push({ ...row, id: "queued-0", status: "queued", updatedAt: new Date(0) });
    jobs.enqueue.mockRejectedValue(new Error("queue unavailable"));
    await expect(reconcileComputerUpdates(deps)).rejects.toThrow("queue unavailable");
    expect(row.status).toBe("failed");
  });

  it("rejects a busy computer before publishing an operation", async () => {
    const { row, deps, computer, jobs } = fixture();
    computer.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(queueComputerUpdate(deps, row.computerId, row.botId)).rejects.toThrow(
      "Computer is busy",
    );
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it("queues the handback when the takeover's sandbox is already gone", async () => {
    const harness = takeoverQueue();
    harness.setScreenControl.mockRejectedValue(
      Object.assign(new Error("No such container"), { name: "SandboxNotFoundError" }),
    );

    await queueComputerUpdate(harness.deps, "computer-1", "bot-1");

    // A dead sandbox holds no control to release: the stranded ref is dropped and
    // the update proceeds instead of reporting busy forever.
    expect(harness.computer.updateMany).toHaveBeenCalledWith({
      where: {
        id: "computer-1",
        providerRef: "provider-1",
        state: { notIn: ["booting", "suspending"] },
        controlLeaseId: expect.any(String),
      },
      data: { state: "stopped", providerRef: null },
    });
    expect(harness.jobs.enqueue).toHaveBeenCalledOnce();
  });

  it("does not release a takeover a run is already waiting on", async () => {
    const harness = takeoverQueue({ controlRunId: "run-1" });

    await expect(queueComputerUpdate(harness.deps, "computer-1", "bot-1")).rejects.toThrow(
      "Computer is busy",
    );

    expect(harness.computer.updateMany).not.toHaveBeenCalled();
    expect(harness.setScreenControl).not.toHaveBeenCalled();
    expect(harness.jobs.enqueue).not.toHaveBeenCalled();
  });

  it("aborts when the idle-takeover CAS loses to a waiting run", async () => {
    const harness = takeoverQueue();
    harness.computer.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(queueComputerUpdate(harness.deps, "computer-1", "bot-1")).rejects.toThrow(
      "Computer is busy",
    );

    expect(harness.setScreenControl).not.toHaveBeenCalled();
    expect(harness.jobs.enqueue).not.toHaveBeenCalled();
    expect(harness.computerUpdate.create).not.toHaveBeenCalled();
  });

  it("queues the handback when the takeover has no provider ref", async () => {
    const harness = takeoverQueue({ providerRef: null });
    harness.setScreenControl.mockRejectedValue(new Error("provider unavailable"));

    await queueComputerUpdate(harness.deps, "computer-1", "bot-1");

    expect(harness.setScreenControl).not.toHaveBeenCalled();
    expect(harness.jobs.cancel).toHaveBeenCalledOnce();
    expect(harness.jobs.enqueue).toHaveBeenCalledOnce();
    expect(harness.computerUpdate.deleteMany).not.toHaveBeenCalled();
  });

  it("does not roll back when screen release is not implemented", async () => {
    const harness = takeoverQueue();
    (harness.deps as { sandbox: { setScreenControl?: unknown } }).sandbox = {};

    await queueComputerUpdate(harness.deps, "computer-1", "bot-1");

    expect(harness.setScreenControl).not.toHaveBeenCalled();
    expect(harness.jobs.enqueue).toHaveBeenCalledOnce();
    expect(harness.computerUpdate.deleteMany).not.toHaveBeenCalled();
  });

  it("refuses maintenance while a failed revoke still holds a lease", async () => {
    const harness = takeoverQueue({
      controlHolder: "none",
      controlBotId: null,
      controlRunId: null,
    });

    await expect(queueComputerUpdate(harness.deps, "computer-1", "bot-1")).rejects.toThrow(
      "Computer is busy",
    );

    expect(harness.computer.updateMany).not.toHaveBeenCalled();
    expect(harness.setScreenControl).not.toHaveBeenCalled();
    expect(harness.jobs.enqueue).not.toHaveBeenCalled();
  });

  it("keeps takeover expiry when a late release cannot clear the lease", async () => {
    const harness = takeoverQueue();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    harness.setScreenControl.mockImplementation(() => pending);
    const work = queueComputerUpdate(harness.deps, "computer-1", "bot-1");
    await vi.waitFor(() => expect(harness.setScreenControl).toHaveBeenCalledOnce());
    await reconcileComputerUpdates(harness.deps);
    harness.computerRow.controlLeaseId = "lease-replaced";
    harness.computerRow.controlRunId = "run-1";

    release();
    await expect(work).rejects.toThrow("Computer is busy");

    expect(harness.jobs.cancel).not.toHaveBeenCalled();
    expect(harness.run.updateMany).not.toHaveBeenCalled();
    expect(harness.jobs.enqueue).not.toHaveBeenCalled();
  });

  it("records revocation before the provider release and confirms it after", async () => {
    const harness = takeoverQueue();
    harness.setScreenControl.mockImplementation(async () => {
      expect(harness.computerUpdate.updateMany).toHaveBeenCalledWith({
        where: { id: "update-1", status: "reserving" },
        data: { status: "revoking" },
      });
      expect(harness.computerUpdate.updateMany).not.toHaveBeenCalledWith({
        where: { id: "update-1", status: "revoking" },
        data: { status: "revoked" },
      });
    });

    await queueComputerUpdate(harness.deps, "computer-1", "bot-1");

    const statusOrder = (status: string) => {
      const index = harness.computerUpdate.updateMany.mock.calls.findIndex(
        (call) => call[0].data?.status === status,
      );
      return harness.computerUpdate.updateMany.mock.invocationCallOrder[index];
    };
    const clearIndex = harness.computer.updateMany.mock.calls.findIndex(
      (call) => call[0]?.data?.controlLeaseId === null,
    );
    const provider = harness.setScreenControl.mock.invocationCallOrder[0];
    const clear = harness.computer.updateMany.mock.invocationCallOrder[clearIndex];
    expect(statusOrder("revoking")).toBeLessThan(provider ?? 0);
    expect(provider).toBeLessThan(statusOrder("revoked") ?? 0);
    expect(statusOrder("revoked")).toBeLessThan(clear ?? 0);
    expect(clear).toBeLessThan(statusOrder("queued") ?? 0);
  });

  it("clears a stale reservation once the lease was already released", async () => {
    const { row, deps, computer } = fixture("reserving");
    computer.updateMany.mockResolvedValueOnce({ count: 0 });

    await reconcileComputerUpdates(deps);

    expect(row.status).toBe("failed");
    expect(computer.updateMany).toHaveBeenLastCalledWith({
      where: { id: row.computerId, maintenanceId: row.id },
      data: { maintenanceId: null },
    });
  });
});

function takeoverQueue(
  overrides: {
    controlHolder?: string;
    controlBotId?: string | null;
    controlRunId?: string | null;
    providerRef?: string | null;
  } = {},
) {
  const computerRow = {
    id: "computer-1",
    kind: "fake",
    scope: "team",
    spaceId: "space",
    userId: "user",
    homeKey: "bot-1",
    providerRef: "provider-1" as string | null,
    state: "running",
    maintenanceId: null,
    controlHolder: "user",
    controlBotId: "bot-1" as string | null,
    controlRunId: null as string | null,
    controlLeaseId: "lease-1" as string | null,
    controlLeaseExpiresAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
  const updateRow = {
    id: "update-1",
    computerId: computerRow.id,
    botId: "bot-1",
    action: "update",
    status: "queued",
    stage: "preparing",
    computer: { ...computerRow, bots: [{ id: "bot-1", name: "Writer" }] },
  };
  const computer = {
    updateMany: vi.fn(async (_args?: { data?: { controlLeaseId?: string | null } }) => ({
      count: 1,
    })),
    findUniqueOrThrow: vi.fn(async () => computerRow),
    findFirst: vi.fn(async (args?: { where?: { controlLeaseId?: string | null } }) => {
      const leaseId = args?.where?.controlLeaseId;
      if (leaseId && leaseId !== computerRow.controlLeaseId) return null;
      return { controlRunId: computerRow.controlRunId };
    }),
  };
  const run = {
    updateMany: vi.fn(async () => ({ count: 1 })),
  };
  const computerUpdate = {
    create: vi.fn(async ({ data }: { data?: { status?: string } }) => {
      if (data?.status) updateRow.status = data.status;
      return updateRow;
    }),
    findUniqueOrThrow: vi.fn(async () => updateRow),
    updateMany: vi.fn(
      async ({ where, data }: { where: { status?: string }; data?: { status?: string } }) => {
        if (where.status && where.status !== updateRow.status) return { count: 0 };
        if (data) Object.assign(updateRow, data);
        return { count: 1 };
      },
    ),
    findMany: vi.fn(async (args?: { where?: { OR?: { status?: string }[] } }) => {
      const statuses = args?.where?.OR?.flatMap((item) => (item.status ? [item.status] : []));
      if (statuses && statuses.length > 0 && !statuses.includes(updateRow.status)) return [];
      return [updateRow];
    }),
    deleteMany: vi.fn(async () => ({ count: 1 })),
  };
  const prisma = {
    $queryRaw: vi.fn(async () => []),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
    computer,
    computerUpdate,
    run,
    bot: { findFirst: vi.fn(async () => ({ thread: { id: "thread-1" } })) },
  };
  const jobs = { enqueue: vi.fn(async () => {}), cancel: vi.fn(async () => {}) };
  const setScreenControl = vi.fn(async () => {});
  const events = { append: vi.fn(async () => ({ threadId: "thread-1", seq: 1 })) };
  const deps = { prisma, jobs, sandbox: { setScreenControl }, events } as unknown as Parameters<
    typeof queueComputerUpdate
  >[0];
  return { computer, computerRow, computerUpdate, deps, events, jobs, run, setScreenControl };
}
