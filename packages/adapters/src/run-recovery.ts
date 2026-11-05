import { isTerminal } from "@labradoodle/core";
import type { PrismaClient } from "@labradoodle/db";
import { expireComputerExecutionLeases } from "@labradoodle/db";
import { EXECUTION_LEASE_MS } from "./computer-lifecycle.js";

type RecoveryRun = { id: string; spaceId: string; userId: string };

/**
 * The runs whose person's computer another run holds. A takeover hold whose run ended or was
 * deleted is expired instead: leases have no relation to runs, so nothing else would free the
 * computer before the hold lapses a day later.
 */
export async function findRunRecoveryBlockers(
  prisma: PrismaClient,
  runs: readonly RecoveryRun[],
  now: Date,
): Promise<Map<string, string>> {
  // A run uses its person's computer in its workspace, so another run's live lease on that
  // computer is what it would wait behind.
  const computers = runs.length
    ? await prisma.computer.findMany({
        where: { OR: runs.map((run) => ({ spaceId: run.spaceId, userId: run.userId })) },
        select: { id: true, spaceId: true, userId: true },
      })
    : [];
  const leases = computers.length
    ? await prisma.computerExecutionLease.findMany({
        where: {
          computerId: { in: computers.map((computer) => computer.id) },
          expiresAt: { gt: now },
        },
        select: { computerId: true, runId: true, expiresAt: true },
      })
    : [];
  const abandoned = await findAbandonedTakeoverHolds(prisma, leases, now);
  if (abandoned.size) {
    // Expire as a tombstone, like a release, so the next run's lease fence still rises.
    await expireComputerExecutionLeases(prisma, {
      runId: { in: [...abandoned] },
      expiresAt: { gt: now },
    });
  }
  const blockers = new Map<string, string>();
  for (const run of runs) {
    const computer = computers.find(
      (computer) => computer.spaceId === run.spaceId && computer.userId === run.userId,
    );
    const lease = computer
      ? leases.find(
          (lease) =>
            lease.computerId === computer.id &&
            lease.runId !== run.id &&
            !abandoned.has(lease.runId),
        )
      : undefined;
    if (lease) blockers.set(run.id, lease.runId);
  }
  return blockers;
}

/**
 * A run lease reaches at most one lease length past its last renewal, and computer operations
 * hold leases under ids that are not runs, so only a lease reaching further is a takeover hold.
 * The margin covers clock skew between hosts.
 */
async function findAbandonedTakeoverHolds(
  prisma: PrismaClient,
  leases: ReadonlyArray<{ runId: string; expiresAt: Date }>,
  now: Date,
): Promise<Set<string>> {
  const holdAfter = now.getTime() + 2 * EXECUTION_LEASE_MS;
  const holders = leases
    .filter((lease) => lease.expiresAt.getTime() > holdAfter)
    .map((lease) => lease.runId);
  if (holders.length === 0) return new Set();
  const live = await prisma.run.findMany({
    where: { id: { in: holders } },
    select: { id: true, status: true },
  });
  const liveIds = new Set(live.filter((run) => !isTerminal(run.status)).map((run) => run.id));
  return new Set(holders.filter((runId) => !liveIds.has(runId)));
}
