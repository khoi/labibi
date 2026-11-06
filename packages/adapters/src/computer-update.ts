import type { AdapterContext } from "@labradoodle/adapter-kit";
import { computerControlExpireJobKey } from "@labradoodle/adapter-kit";
import type { ComputerUpdate } from "@labradoodle/contracts";
import { ComputerUpdateSchema } from "@labradoodle/contracts";
import type { Prisma, PrismaClient, ThreadEvents } from "@labradoodle/db";
import { getLogger } from "@labradoodle/logging";
import {
  enqueueTakeoverContinuation,
  isIdleOwnComputerTakeover,
  revokeScreenControl,
} from "./computer-control.js";
import { scheduleComputerSleep } from "./computer-idle.js";
import {
  ComputerBusyError,
  computerSupportsUpdate,
  replaceComputer,
} from "./computer-lifecycle.js";

type Deps = Parameters<typeof replaceComputer>[0];
type QueueDeps = Pick<Deps, "prisma" | "jobs"> &
  Partial<Pick<Deps, "sandbox">> & {
    events?: Pick<ThreadEvents, "append">;
  };
const STALE_MS = 10 * 60_000;
// Far longer than any provider call should run. Past it, reconciliation assumes an
// interrupted worker's provider calls have ended.
const ABANDONED_MS = 60 * 60_000;
// reserving: claimed, provider release not started. revoking: call not returned.
// revoked: provider release returned, lease write still missing.
const UNCONFIRMED_HANDBACK_STATUSES = ["reserving", "revoking"] as const;
const PENDING_HANDBACK_STATUSES = ["reserving", "revoking", "revoked"] as const;

export function computerUpdateView(row: {
  action: string;
  id: string;
  status: string;
  stage: string;
}): ComputerUpdate {
  return ComputerUpdateSchema.parse({
    canReleaseReservation: false,
    action: row.action,
    id: row.id,
    status: row.status,
    stage: row.stage,
  });
}

export async function queueComputerUpdate(
  deps: QueueDeps,
  computerId: string,
  botId: string,
  action: "update" | "recover" = "update",
) {
  const prepared = await deps.prisma.$transaction(async (tx) => {
    // Mode switches lock this same row before marking a bot as switching.
    // The following statement then observes their committed reservation.
    await tx.$queryRaw`SELECT id FROM computers WHERE id = ${computerId} FOR UPDATE`;
    const computer = await tx.computer.findUniqueOrThrow({ where: { id: computerId } });
    if (action === "update" && !computerSupportsUpdate(computer.kind))
      throw new Error("Computer update is not available on this device");
    // A run bound to this takeover must keep it. Maintenance does not resume that run.
    if (computer.controlHolder === "user" && computer.controlRunId) {
      throw new ComputerBusyError();
    }
    const idleTakeover = isIdleOwnComputerTakeover(computer);
    // Holder "none" plus a lease means a provider revoke failed and control may remain.
    if (computer.controlLeaseId && !idleTakeover) throw new ComputerBusyError();

    let handback: IdleTakeoverHandback | null = null;
    if (idleTakeover) {
      const cleared = await tx.computer.updateMany({
        where: {
          id: computerId,
          controlHolder: "user",
          controlRunId: null,
          controlLeaseId: computer.controlLeaseId,
        },
        data: computer.controlLeaseId
          ? { controlHolder: "none" }
          : {
              controlHolder: "none",
              controlLeaseExpiresAt: null,
              controlRunId: null,
            },
      });
      // The waiting-run check is this CAS: a run that attached loses the claim with it.
      if (cleared.count !== 1) throw new ComputerBusyError();
      handback = {
        leaseId: computer.controlLeaseId,
        expiresAt: computer.controlLeaseExpiresAt,
        providerRef: computer.providerRef,
        kind: computer.kind,
        homeKey: computer.homeKey,
        spaceId: computer.spaceId,
        userId: computer.userId,
        botId,
      };
    }

    const revokeLeaseId = handback?.leaseId ?? null;
    const update = await tx.computerUpdate.create({
      data: {
        computerId,
        action,
        // Stay reserving until the provider release is attempted. Reconciliation gives that
        // takeover back. revoking is written before the call and is not proof of release.
        // revoked is written after the provider returns; reconciliation then clears the lease.
        ...(revokeLeaseId ? { status: "reserving" } : {}),
      },
    });
    const claimed = await tx.computer.updateMany({
      where: {
        id: computerId,
        maintenanceId: null,
        state: { notIn: ["booting", "suspending"] },
        controlHolder: { not: "user" },
        controlLeaseId: revokeLeaseId,
        executionLeases: { none: { expiresAt: { gt: new Date() } } },
      },
      data: { maintenanceId: update.id },
    });
    if (claimed.count !== 1) throw new ComputerBusyError();
    await tx.computerUpdate.updateMany({
      where: { computerId, status: "failed" },
      data: { status: "dismissed" },
    });
    const row = await tx.computerUpdate.findUniqueOrThrow({ where: { id: update.id } });
    return { row, handback };
  });

  if (prepared.handback?.leaseId) {
    // Provider release is optional. CreateOS ignores a non-interactive release, and a host
    // whose provider has no release method resolves. Only a thrown release rolls the claim back.
    // Bound: provider methods use `this`, and a detached call throws before releasing.
    const releaseScreen = prepared.handback.providerRef
      ? deps.sandbox?.setScreenControl?.bind(deps.sandbox)
      : undefined;
    if (releaseScreen) {
      // Persist revoking before the provider call so a crash is visible. That status is not
      // proof of release: reconciliation gives the takeover back. After the provider returns,
      // persist revoked before the lease write so reconciliation can clear a confirmed release.
      const marked = await deps.prisma.computerUpdate.updateMany({
        where: { id: prepared.row.id, status: "reserving" },
        data: { status: "revoking" },
      });
      if (marked.count !== 1) {
        await undoQueuedMaintenance(deps.prisma, computerId, prepared.row.id, prepared.handback);
        throw new ComputerBusyError();
      }
      prepared.row.status = "revoking";
      const context: AdapterContext = {
        operationId: prepared.row.id,
        traceId: prepared.row.id,
        spaceId: prepared.handback.spaceId,
        userId: prepared.handback.userId,
        botId,
        signal: new AbortController().signal,
      };
      try {
        await revokeScreenControl(
          { prisma: deps.prisma, sandbox: deps.sandbox },
          { id: computerId, ...prepared.handback },
          context,
          prepared.handback.leaseId,
        );
      } catch (error) {
        getLogger().error("release own takeover before maintenance", error);
        await undoQueuedMaintenance(deps.prisma, computerId, prepared.row.id, prepared.handback);
        throw new ComputerBusyError();
      }
      const confirmed = await deps.prisma.computerUpdate.updateMany({
        where: { id: prepared.row.id, status: "revoking" },
        data: { status: "revoked" },
      });
      if (confirmed.count !== 1) {
        // Reconciliation handed the takeover back while this call was pending. The provider
        // has now released. Clear that lease, including a run that bound to it, and resume
        // the run. Leave the expiry job when the lease is still held. Do not queue the update.
        const released = await releaseConfirmedHandback(
          deps.prisma,
          computerId,
          prepared.row.id,
          prepared.handback,
        );
        if (released.cleared) {
          await deps.jobs
            .cancel(computerControlExpireJobKey(computerId, prepared.handback.leaseId))
            .catch((error) => {
              getLogger().error("computer control expiry cancellation", error);
            });
          await enqueueTakeoverContinuation(deps.jobs, released.runId);
        }
        throw new ComputerBusyError();
      }
      prepared.row.status = "revoked";
    }
    await deps.jobs
      .cancel(computerControlExpireJobKey(computerId, prepared.handback.leaseId))
      .catch((error) => {
        getLogger().error("computer control expiry cancellation", error);
      });
    const released = await deps.prisma.computer.updateMany({
      where: {
        id: computerId,
        maintenanceId: prepared.row.id,
        controlHolder: "none",
        controlRunId: null,
        // Takeover expiry can clear this lease after the reservation and before this write.
        // Control is already free in that case; discarding the update would report busy.
        OR: [{ controlLeaseId: prepared.handback.leaseId }, { controlLeaseId: null }],
      },
      data: {
        controlLeaseId: null,
        controlUserId: null,
        controlLeaseExpiresAt: null,
        controlRunId: null,
      },
    });
    if (released.count !== 1) {
      if (prepared.row.status === "revoked") {
        await abandonRevokedHandback(deps.prisma, computerId, prepared.row.id);
      } else {
        await undoQueuedMaintenance(deps.prisma, computerId, prepared.row.id, prepared.handback);
      }
      throw new ComputerBusyError();
    }
    const queued = await deps.prisma.computerUpdate.updateMany({
      where: { id: prepared.row.id, status: prepared.row.status },
      data: { status: "queued" },
    });
    if (queued.count !== 1) {
      await dropMaintenanceReservation(deps.prisma, computerId, prepared.row.id);
      throw new ComputerBusyError();
    }
    prepared.row.status = "queued";
  }

  // The reconciler republishes durable queued intent if publishing fails.
  await deps.jobs
    .enqueue({
      name: "computer.update",
      payload: { updateId: prepared.row.id },
      replaceKey: `computer.update:${prepared.row.id}`,
    })
    .catch(() => undefined);
  return computerUpdateView(prepared.row);
}

type IdleTakeoverHandback = {
  leaseId: string | null;
  expiresAt: Date | null;
  providerRef: string | null;
  kind: string;
  homeKey: string;
  spaceId: string;
  userId: string;
  botId: string;
};

async function undoQueuedMaintenance(
  prisma: PrismaClient,
  computerId: string,
  updateId: string,
  handback: IdleTakeoverHandback,
) {
  try {
    await prisma.$transaction(async (tx) => {
      const restored = await tx.computer.updateMany({
        where: {
          id: computerId,
          maintenanceId: updateId,
          controlHolder: "none",
          controlLeaseId: handback.leaseId,
          controlRunId: null,
        },
        data: {
          maintenanceId: null,
          controlHolder: "user",
          controlRunId: null,
        },
      });
      if (restored.count !== 1) {
        await tx.computer.updateMany({
          where: { id: computerId, maintenanceId: updateId },
          data: { maintenanceId: null },
        });
      }
      await tx.computerUpdate.deleteMany({
        where: { id: updateId, status: { in: [...UNCONFIRMED_HANDBACK_STATUSES] } },
      });
    });
  } catch (error) {
    getLogger().error("undo maintenance takeover", error);
    await prisma.computerUpdate
      .updateMany({
        where: { id: updateId, status: { in: ["queued", "reserving", "revoking"] } },
        data: { status: "dismissed" },
      })
      .catch(() => undefined);
    await prisma.computer
      .updateMany({
        where: { id: computerId, maintenanceId: updateId },
        data: { maintenanceId: null },
      })
      .catch(() => undefined);
  }
}

async function dropMaintenanceReservation(
  prisma: PrismaClient,
  computerId: string,
  updateId: string,
) {
  await prisma.$transaction(async (tx) => {
    await tx.computer.updateMany({
      where: { id: computerId, maintenanceId: updateId },
      data: { maintenanceId: null },
    });
    await tx.computerUpdate.deleteMany({
      where: { id: updateId, status: { in: [...PENDING_HANDBACK_STATUSES] } },
    });
  });
}

async function releaseConfirmedHandback(
  prisma: PrismaClient,
  computerId: string,
  updateId: string,
  handback: IdleTakeoverHandback,
): Promise<{ cleared: boolean; runId: string | null }> {
  if (!handback.leaseId) return { cleared: false, runId: null };
  // The lease may still sit on the maintenance claim, or reconciliation may have given it
  // back to the user. A run can bind before this write. The screen is already released, so
  // clear that lease and resume the run. Skip a newer maintenance claim.
  try {
    return await prisma.$transaction(async (tx) => {
      const current = await tx.computer.findFirst({
        where: {
          id: computerId,
          controlLeaseId: handback.leaseId,
          OR: [{ maintenanceId: updateId }, { maintenanceId: null, controlHolder: "user" }],
        },
        select: { controlRunId: true },
      });
      if (!current) return { cleared: false, runId: null };
      const cleared = await tx.computer.updateMany({
        where: {
          id: computerId,
          controlLeaseId: handback.leaseId,
          controlRunId: current.controlRunId,
          OR: [{ maintenanceId: updateId }, { maintenanceId: null, controlHolder: "user" }],
        },
        data: {
          maintenanceId: null,
          controlHolder: "none",
          controlLeaseId: null,
          controlUserId: null,
          controlLeaseExpiresAt: null,
          controlRunId: null,
        },
      });
      if (cleared.count !== 1) return { cleared: false, runId: null };
      const runId = current.controlRunId
        ? await resumeBoundTakeoverRun(tx, handback, current.controlRunId)
        : null;
      return { cleared: true, runId };
    });
  } catch (error) {
    getLogger().error("release confirmed takeover", error);
    return { cleared: false, runId: null };
  }
}

async function resumeBoundTakeoverRun(
  tx: Prisma.TransactionClient,
  handback: IdleTakeoverHandback,
  runId: string,
): Promise<string | null> {
  const resumed = await tx.run.updateMany({
    where: {
      id: runId,
      spaceId: handback.spaceId,
      botId: handback.botId,
      status: "waiting_takeover",
    },
    data: { status: "queued", checkpoint: "takeover" },
  });
  const stamped =
    resumed.count === 1
      ? { count: 0 }
      : await tx.run.updateMany({
          where: {
            id: runId,
            spaceId: handback.spaceId,
            botId: handback.botId,
            status: { in: ["leased", "running"] },
          },
          data: { checkpoint: "takeover" },
        });
  return resumed.count === 1 || stamped.count === 1 ? runId : null;
}

async function abandonRevokedHandback(prisma: PrismaClient, computerId: string, updateId: string) {
  try {
    await prisma.$transaction(async (tx) => {
      await clearRevokedTakeover(tx.computer, computerId, updateId);
      await tx.computerUpdate.deleteMany({
        where: { id: updateId, status: { in: [...PENDING_HANDBACK_STATUSES] } },
      });
    });
  } catch (error) {
    getLogger().error("abandon revoked takeover", error);
    await prisma.computerUpdate
      .updateMany({
        where: { id: updateId, status: { in: ["reserving", "revoking"] } },
        data: { status: "dismissed" },
      })
      .catch(() => undefined);
    await clearRevokedTakeover(prisma.computer, computerId, updateId).catch(() => undefined);
  }
}

async function clearRevokedTakeover(
  computer: PrismaClient["computer"],
  computerId: string,
  updateId: string,
) {
  const cleared = await computer.updateMany({
    where: {
      id: computerId,
      maintenanceId: updateId,
      controlHolder: "none",
      controlRunId: null,
    },
    data: {
      maintenanceId: null,
      controlHolder: "none",
      controlLeaseId: null,
      controlUserId: null,
      controlLeaseExpiresAt: null,
      controlRunId: null,
    },
  });
  if (cleared.count === 1) return;
  await computer.updateMany({
    where: { id: computerId, maintenanceId: updateId },
    data: { maintenanceId: null },
  });
}

export async function performComputerUpdate(deps: Deps, updateId: string) {
  const claimed = await deps.prisma.computerUpdate.updateMany({
    where: { id: updateId, status: "queued" },
    data: { status: "running" },
  });
  if (claimed.count !== 1) return; // Never replay a destructive operation on job redelivery.
  const update = await deps.prisma.computerUpdate.findUniqueOrThrow({
    where: { id: updateId },
    include: { computer: true },
  });
  const controller = new AbortController();
  const heartbeat = setInterval(() => {
    void deps.prisma.computerUpdate
      .updateMany({ where: { id: updateId, status: "running" }, data: { updatedAt: new Date() } })
      .then((result) => {
        if (result.count !== 1) controller.abort();
      })
      .catch(() => controller.abort());
  }, 30_000);
  try {
    const doodle = await deps.prisma.bot.findUnique({
      where: { spaceId: update.computer.spaceId },
      select: { id: true },
    });
    await replaceComputer(
      deps,
      update.computerId,
      update.action === "recover" ? "recover" : "update",
      {
        operationId: updateId,
        traceId: updateId,
        ...(doodle ? { botId: doodle.id } : {}),
        spaceId: update.computer.spaceId,
        userId: update.computer.userId,
        signal: controller.signal,
      },
      "none",
      async (stage) => {
        controller.signal.throwIfAborted();
        const result = await deps.prisma.computerUpdate.updateMany({
          where: { id: updateId, status: "running" },
          data: { stage: update.action === "recover" && stage === "saving" ? "preparing" : stage },
        });
        if (result.count !== 1) throw new Error("Computer update interrupted");
      },
    );
    await finishUpdate(deps.prisma, updateId, update.computerId, "completed");
  } catch (error) {
    getLogger().error("computer update failed", error, {
      updateId,
      computerId: update.computerId,
    });
    // Provider errors may contain credentials or private URLs. Expose only the failed stage.
    await finishUpdate(deps.prisma, updateId, update.computerId, "failed");
  } finally {
    clearInterval(heartbeat);
  }
  // A failure before teardown leaves the computer running, so idle sleep resumes either way.
  scheduleComputerSleep(deps.jobs, update.computerId);
}

async function finishUpdate(
  prisma: PrismaClient,
  id: string,
  computerId: string,
  status: "completed" | "failed",
) {
  await prisma.$transaction(async (tx) => {
    const finished = await tx.computerUpdate.updateMany({
      where: { id, status: { in: ["running", "interrupted"] } },
      data: { status },
    });
    if (finished.count !== 1) return;
    await tx.computer.updateMany({
      where: { id: computerId, maintenanceId: id },
      data: { maintenanceId: null },
    });
  });
}

export async function reconcileComputerUpdates(deps: Pick<Deps, "prisma" | "jobs">) {
  const select = (where: Prisma.ComputerUpdateWhereInput) =>
    deps.prisma.computerUpdate.findMany({ where, take: 100, orderBy: { updatedAt: "asc" } });
  // Republishing leaves a queued row untouched, so a backlog of them would fill every pass.
  // Stalled rows go first so a failing republish cannot keep a computer reserved.
  const updates = [
    ...(await select({
      OR: [
        { status: "running", updatedAt: { lt: new Date(Date.now() - STALE_MS) } },
        { status: "reserving", updatedAt: { lt: new Date(Date.now() - STALE_MS) } },
        { status: "revoking", updatedAt: { lt: new Date(Date.now() - STALE_MS) } },
        { status: "revoked", updatedAt: { lt: new Date(Date.now() - STALE_MS) } },
        { status: "interrupted", updatedAt: { lt: new Date(Date.now() - ABANDONED_MS) } },
      ],
    })),
    ...(await select({ status: "queued" })),
  ];
  for (const update of updates) {
    if (update.status === "queued") {
      await deps.jobs.enqueue({
        name: "computer.update",
        payload: { updateId: update.id },
        replaceKey: `computer.update:${update.id}`,
      });
    } else if (
      update.status === "reserving" ||
      update.status === "revoking" ||
      update.status === "revoked"
    ) {
      const status = update.status;
      await deps.prisma.$transaction(async (tx) => {
        const stale = await tx.computerUpdate.updateMany({
          where: { id: update.id, status, updatedAt: update.updatedAt },
          data: { status: "failed" },
        });
        if (stale.count !== 1) return;
        if (status === "revoked") {
          // The provider release returned. Clear the lease with the holder so a later
          // takeover grants a new lease.
          await clearRevokedTakeover(tx.computer, update.computerId, update.id);
          return;
        }
        // The provider release has not returned, so control can still belong to the user.
        const restored = await tx.computer.updateMany({
          where: {
            id: update.computerId,
            maintenanceId: update.id,
            controlHolder: "none",
            controlRunId: null,
            controlLeaseId: { not: null },
          },
          data: { maintenanceId: null, controlHolder: "user" },
        });
        if (restored.count === 1) return;
        await tx.computer.updateMany({
          where: { id: update.computerId, maintenanceId: update.id },
          data: { maintenanceId: null },
        });
      });
    } else if (update.status === "interrupted") {
      const released = await deps.prisma.$transaction(async (tx) => {
        const abandoned = await tx.computerUpdate.updateMany({
          where: { id: update.id, status: "interrupted", updatedAt: update.updatedAt },
          data: { status: "failed" },
        });
        if (abandoned.count !== 1) return false;
        // Only this update can hold a booting or suspending claim under its reservation, and
        // Recover refuses both. Unlike its worker, this cannot tell what the claim started
        // from, so a machine still attached may be running or half destroyed: quarantine it,
        // as after an unconfirmed stop, so no bot uses it until it is replaced. Any other
        // claim ends as an error, as provisionComputer's failure write leaves a boot.
        const reserved = { id: update.computerId, maintenanceId: update.id };
        await tx.computer.updateMany({
          where: { ...reserved, state: "suspending", providerRef: { not: null } },
          data: { state: "quarantined" },
        });
        await tx.computer.updateMany({
          where: { ...reserved, state: { in: ["booting", "suspending"] } },
          data: { state: "error" },
        });
        await tx.computer.updateMany({ where: reserved, data: { maintenanceId: null } });
        return true;
      });
      if (released) scheduleComputerSleep(deps.jobs, update.computerId);
    } else {
      await deps.prisma.$transaction(async (tx) => {
        const stale = await tx.computerUpdate.updateMany({
          where: { id: update.id, status: "running", updatedAt: update.updatedAt },
          data: { status: "interrupted" },
        });
        // A stale heartbeat is not proof that provider calls have stopped. The worker's
        // settled path releases this reservation, or reconciliation does after ABANDONED_MS.
        if (stale.count !== 1) return;
      });
    }
  }
}
