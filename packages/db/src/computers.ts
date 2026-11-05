import { createHash, randomUUID } from "node:crypto";
import { isTerminal } from "@labradoodle/core";
import type { PrismaClient } from "./client.js";
import { Prisma } from "./client.js";
import { runAsSystem, runAsSystemInTransaction } from "./row-security.js";
import { withTransactionRetry } from "./transaction-retry.js";

/** Every person has one computer in each workspace they belong to; Doodle uses the asker's. */
export type ComputerKeyInput = { spaceId: string; userId: string };

export function computerScopeKey(input: ComputerKeyInput) {
  return `team:${input.spaceId}:${input.userId}`;
}

/**
 * Sandbox providers receive the home key as the computer's id, and the Docker supervisor keeps
 * only its first 40 characters in container names, so the key is a fixed-length digest that
 * stays distinct per workspace and person. Migration 20261021000000 computes the same value in
 * SQL.
 */
export function computerHomeKey(input: ComputerKeyInput) {
  const digest = createHash("sha256")
    .update(`${input.spaceId}:${input.userId}`)
    .digest("hex")
    .slice(0, 32);
  return `team-${digest}`;
}

type ComputerDb = Pick<PrismaClient, "computer">;
type ComputerTx = Pick<Prisma.TransactionClient, "computer" | "$queryRaw">;
type ComputerClient = ComputerDb & Partial<Pick<PrismaClient, "$transaction" | "$queryRaw">>;
type ExecutionLeaseDb = Pick<PrismaClient, "computerExecutionLease">;

/**
 * Per-user ceiling on Computer records, or 0 when unset. Each row becomes a sandbox container
 * once provisioned, and a person has one in each workspace they use one in.
 */
export function resolveMaxComputersPerUser(
  value = process.env.SANDBOX_MAX_COMPUTERS_PER_USER,
): number {
  if (value === undefined || value.trim() === "" || value.trim() === "0") return 0;
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error(
      "SANDBOX_MAX_COMPUTERS_PER_USER must be a positive integer, or 0 for no configured cap",
    );
  }
  return limit;
}

export class ComputerLimitError extends Error {
  constructor(limit: number) {
    super(`User computer limit (${limit}) reached`);
    this.name = "ComputerLimitError";
  }
}

async function countComputersForUser(
  prisma: ComputerDb & Partial<Pick<PrismaClient, "$queryRaw">>,
  userId: string,
): Promise<number> {
  const count = () => prisma.computer.count({ where: { userId } });
  // The quota is per person, so it counts the computers of all their Spaces.
  const reason = "computer quota across the user's Spaces";
  return prisma.$queryRaw
    ? runAsSystemInTransaction(prisma as Pick<PrismaClient, "$queryRaw">, reason, count)
    : runAsSystem(reason, count);
}

/**
 * Serialize existence check + in-use count + Computer create for one user.
 * Seed 1 keeps this keyspace apart from lockSpaceForContentCreation (seed 0).
 */
async function lockUserForComputerQuota(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  userId: string,
): Promise<void> {
  await tx.$queryRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 1))::text AS "lock"
  `);
}

/** Expire leases as fencing tombstones so the next acquire increments fence. */
export async function expireComputerExecutionLeases(
  prisma: ExecutionLeaseDb,
  where: Prisma.ComputerExecutionLeaseWhereInput,
): Promise<void> {
  await prisma.computerExecutionLease.updateMany({
    where,
    data: { expiresAt: new Date(0) },
  });
}

type ExecutionBindingDb = Pick<PrismaClient, "computer" | "run">;

/**
 * Clear a legacy execution binding whose run can no longer execute. Pre-lease releases
 * wrote Computer.executionRunId and only the run's own teardown cleared it, so a
 * binding stranded by a missed cleanup blocks computer suspension forever: suspension
 * requires a null binding. Bindings to runs that may still execute are left alone.
 */
export async function clearEndedExecutionRunBinding(
  prisma: ExecutionBindingDb,
  computerId: string,
): Promise<void> {
  const binding = await prisma.computer.findUnique({
    where: { id: computerId },
    select: { executionRunId: true },
  });
  const runId = binding?.executionRunId;
  if (!runId) return;
  const run = await prisma.run.findUnique({ where: { id: runId }, select: { status: true } });
  if (run && !isTerminal(run.status)) return;
  await prisma.computer.updateMany({
    where: { id: computerId, executionRunId: runId },
    data: { executionRunId: null, executionLeaseExpiresAt: null },
  });
}

type ComputerRecordInput = ComputerKeyInput & { kind: string };

async function upsertComputerRecord(
  prisma: ComputerDb,
  input: ComputerRecordInput,
  scopeKey: string,
) {
  return prisma.computer.upsert({
    where: { scopeKey },
    create: {
      spaceId: input.spaceId,
      userId: input.userId,
      scopeKey,
      homeKey: await availableHomeKey(prisma, input, scopeKey),
      kind: input.kind,
    },
    update: {},
  });
}

/**
 * The usual home key, unless another computer still holds it, as one kept from before this
 * person left the workspace can. Coming back, they get a new home of the same length.
 */
async function availableHomeKey(
  prisma: ComputerDb,
  input: ComputerKeyInput,
  scopeKey: string,
): Promise<string> {
  const homeKey = computerHomeKey(input);
  const holder = await prisma.computer.findUnique({
    where: { homeKey },
    select: { scopeKey: true },
  });
  if (!holder || holder.scopeKey === scopeKey) return homeKey;
  const digest = createHash("sha256")
    .update(`${input.spaceId}:${input.userId}:${randomUUID()}`)
    .digest("hex")
    .slice(0, 32);
  return `team-${digest}`;
}

async function ensureComputerRecordWithQuota(
  tx: ComputerTx,
  input: ComputerRecordInput,
  limit: number,
  scopeKey: string,
) {
  await lockUserForComputerQuota(tx, input.userId);
  // Only a new row consumes quota.
  const existing = await tx.computer.findUnique({
    where: { scopeKey },
    select: { id: true },
  });
  if (!existing && (await countComputersForUser(tx, input.userId)) + 1 > limit) {
    throw new ComputerLimitError(limit);
  }
  return upsertComputerRecord(tx, input, scopeKey);
}

function isTransactionClient(prisma: ComputerClient): prisma is ComputerTx {
  return typeof prisma.$queryRaw === "function" && typeof prisma.$transaction !== "function";
}

export async function ensureComputerRecord(prisma: ComputerClient, input: ComputerRecordInput) {
  const limit = resolveMaxComputersPerUser();
  const scopeKey = computerScopeKey(input);
  if (limit <= 0) return upsertComputerRecord(prisma, input, scopeKey);

  // Cap is set: hold a per-user advisory lock across find + count + create so
  // concurrent creates for different spaces cannot both pass the check.
  if (isTransactionClient(prisma)) {
    return ensureComputerRecordWithQuota(prisma, input, limit, scopeKey);
  }
  if (typeof prisma.$transaction === "function") {
    return withTransactionRetry(() =>
      prisma.$transaction!((tx) => ensureComputerRecordWithQuota(tx, input, limit, scopeKey)),
    );
  }
  throw new Error("Computer quota enforcement requires a Prisma transaction");
}

export type RunTeardownTarget = {
  id: string;
  homeKey: string;
  kind: string;
  providerRef: string | null;
  runId: string;
  fence: number;
};

/**
 * The computers these runs hold, for the caller to stop their work on once it commits.
 * `expiresAfter` keeps leases newer than that instant. Resume passes the cleanup epoch.
 */
export async function snapshotRunTeardownTargets(
  tx: Prisma.TransactionClient,
  runIds: string[],
  expiresAfter?: Date,
  ignoreStaleLegacy = false,
): Promise<{ leasedRunIds: string[]; targets: RunTeardownTarget[] }> {
  if (runIds.length === 0) return { leasedRunIds: [], targets: [] };
  const leases = await tx.computerExecutionLease.findMany({
    where: {
      runId: { in: runIds },
      ...(expiresAfter ? { expiresAt: { gt: expiresAfter } } : {}),
    },
    select: { computerId: true, runId: true, fence: true },
  });
  const leasedRunIds = [...new Set(leases.map((lease) => lease.runId))];
  // Reclaim rewrites the lease runId. Resume must not follow a leftover executionRunId.
  const legacyRunIds = ignoreStaleLegacy ? leasedRunIds : runIds;
  if (legacyRunIds.length === 0) return { leasedRunIds, targets: [] };

  const leaseComputerIds = [...new Set(leases.map((lease) => lease.computerId))];
  const computers = await tx.computer.findMany({
    where: leaseComputerIds.length
      ? { OR: [{ id: { in: leaseComputerIds } }, { executionRunId: { in: legacyRunIds } }] }
      : { executionRunId: { in: legacyRunIds } },
    select: { id: true, homeKey: true, kind: true, providerRef: true, executionRunId: true },
  });
  const computerById = new Map(computers.map((computer) => [computer.id, computer]));
  const targets: RunTeardownTarget[] = [];
  const seen = new Set<string>();
  const addTarget = (computerId: string, runId: string, fence: number) => {
    const computer = computerById.get(computerId);
    if (!computer || seen.has(`${computerId}:${runId}`)) return;
    seen.add(`${computerId}:${runId}`);
    const { id, homeKey, kind, providerRef } = computer;
    targets.push({ id, homeKey, kind, providerRef, runId, fence });
  };
  for (const lease of leases) addTarget(lease.computerId, lease.runId, lease.fence);
  for (const computer of computers) {
    if (!computer.executionRunId || !legacyRunIds.includes(computer.executionRunId)) continue;
    addTarget(computer.id, computer.executionRunId, 0);
  }
  return { leasedRunIds, targets };
}

/** After teardown: expire the cancelled runs' leases and legacy bindings. */
export async function releaseCancelledRunLeases(prisma: PrismaClient, runIds: string[]) {
  if (runIds.length === 0) return;
  await expireComputerExecutionLeases(prisma, { runId: { in: runIds } });
  await prisma.computer.updateMany({
    where: { executionRunId: { in: runIds } },
    data: { executionRunId: null, executionLeaseExpiresAt: null },
  });
}
