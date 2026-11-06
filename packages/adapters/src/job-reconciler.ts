import { setImmediate } from "node:timers/promises";
import type { JobPublisher, NotificationProvider } from "@labradoodle/adapter-kit";
import { routineWakeupJob, runContinueJob } from "@labradoodle/adapter-kit";
import type { Pool, PrismaClient, ThreadEvents } from "@labradoodle/db";
import { getLogger } from "@labradoodle/logging";
import type { PoolClient } from "pg";
import { scheduleComputerControlExpiry } from "./computer-control.js";
import { findRunRecoveryBlockers } from "./run-recovery.js";
import { reconcileStuckWork } from "./stuck-work.js";

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_BATCH_SIZE = 100;
const ROUTINE_LOOKAHEAD_MS = 60_000;
const CONTROL_LOOKAHEAD_MS = 60_000;
/**
 * A queued run's job lock older than a run lease is abandoned. A live worker
 * finishing a failed attempt holds it for seconds before Graphile unlocks it.
 */
const ABANDONED_QUEUED_LOCK_MS = 5 * 60_000;
// Two keys give Labradoodle's lock a namespace without relying on a hash that might collide
// with an application using the one-key advisory-lock API.
const RECONCILIATION_LOCK_NAMESPACE = 1_380_019_075;
const RECONCILIATION_LOCK_ID = 1;

type Cursor = { at: Date; id: string };
type ControlCursor = { at: Date | null; id: string };

export interface ReconciliationLeadership {
  tryAcquire(): Promise<boolean>;
  release(): Promise<void>;
}

/**
 * Holds a session advisory lock for the lifetime of the elected reconciler. Followers
 * retry on every reconciliation interval, so a disconnected or stopped leader is
 * replaced without coordinating through application state.
 */
export function createPostgresReconciliationLeadership(
  pool: Pick<Pool, "connect">,
  options: { lockId?: number } = {},
): ReconciliationLeadership {
  const lockId = options.lockId ?? RECONCILIATION_LOCK_ID;
  let leaderClient: PoolClient | undefined;
  let leaderErrorListener: (() => void) | undefined;

  const loseClient = (client: PoolClient) => {
    if (leaderClient !== client) return;
    leaderClient = undefined;
    leaderErrorListener = undefined;
    client.release(true);
  };

  return {
    async tryAcquire() {
      if (leaderClient) return true;

      const candidate = await pool.connect();
      try {
        const result = await candidate.query<{ acquired: boolean }>(
          "SELECT pg_try_advisory_lock($1::integer, $2::integer) AS acquired",
          [RECONCILIATION_LOCK_NAMESPACE, lockId],
        );
        if (!result.rows[0]?.acquired) {
          candidate.release();
          return false;
        }

        leaderClient = candidate;
        leaderErrorListener = () => loseClient(candidate);
        candidate.once("error", leaderErrorListener);
        return true;
      } catch (error) {
        candidate.release(true);
        throw error;
      }
    },

    async release() {
      const client = leaderClient;
      if (!client) return;
      leaderClient = undefined;
      if (leaderErrorListener) client.removeListener("error", leaderErrorListener);
      leaderErrorListener = undefined;

      let destroy = false;
      try {
        const result = await client.query<{ released: boolean }>(
          "SELECT pg_advisory_unlock($1::integer, $2::integer) AS released",
          [RECONCILIATION_LOCK_NAMESPACE, lockId],
        );
        destroy = result.rows[0]?.released !== true;
      } catch {
        // Never return a connection with an uncertain session lock to the pool.
        destroy = true;
      } finally {
        client.release(destroy);
      }
    },
  };
}

export function createJobReconciler(
  deps: {
    prisma: PrismaClient;
    jobs: JobPublisher;
    events?: ThreadEvents;
    notifications?: NotificationProvider;
    leadership?: ReconciliationLeadership;
    reconcileComputerUpdates?: () => Promise<void>;
    reconcileCloudAgents?: () => Promise<void>;
    reconcilePurchases?: () => Promise<void>;
    reconcileMediaVideos?: () => Promise<void>;
    reconcileRoutineRetryNotices?: () => Promise<void>;
    reconcileSecurityEventRetention?: () => Promise<void>;
    reconcileAuditLog?: () => Promise<void>;
    reconcileHomeStorage?: () => Promise<void>;
    reconcileIdleComputers?: () => Promise<void>;
    reconcileDeadJobs?: () => Promise<void>;
  },
  options: { intervalMs?: number; batchSize?: number; maxPagesPerPass?: number } = {},
) {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxPagesPerPass = options.maxPagesPerPass ?? 10;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) throw new Error("Invalid batch size");
  if (!Number.isSafeInteger(maxPagesPerPass) || maxPagesPerPass < 1) {
    throw new Error("Invalid page budget");
  }
  let stopping = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let reconciling: Promise<void> | undefined;
  let lastCompletedAt = Date.now();
  let stuckCursor: Cursor | undefined;
  let runCursor: Cursor | undefined;
  let routineCursor: Cursor | undefined;
  let controlCursor: ControlCursor | undefined;
  let controlScanDeadline: Date | undefined;

  const reconcileOnce = async () => {
    if (reconciling) return reconciling;
    if (stopping) return;
    reconciling = (async () => {
      if (deps.leadership && !(await deps.leadership.tryAcquire())) return;

      const auxiliary = await Promise.allSettled(
        [
          deps.reconcileCloudAgents,
          deps.reconcilePurchases,
          deps.reconcileMediaVideos,
          deps.reconcileComputerUpdates,
          deps.reconcileRoutineRetryNotices,
          deps.reconcileSecurityEventRetention,
          deps.reconcileAuditLog,
          deps.reconcileHomeStorage,
          deps.reconcileIdleComputers,
          deps.reconcileDeadJobs,
        ].map(async (reconcile) => reconcile?.()),
      );
      for (const result of auxiliary) {
        if (result.status === "rejected")
          getLogger().error("auxiliary reconciliation", result.reason);
      }

      const now = new Date();
      try {
        stuckCursor = await reconcileStuckWork({
          prisma: deps.prisma,
          jobs: deps.jobs,
          events: deps.events,
          notifications: deps.notifications,
          now,
          batchSize,
          cursor: stuckCursor,
        });
      } catch (error) {
        getLogger().error("stuck work reconciliation", error);
      }
      const runCursorFilter = runCursor
        ? {
            OR: [
              { updatedAt: { gt: runCursor.at } },
              { updatedAt: runCursor.at, id: { gt: runCursor.id } },
            ],
          }
        : undefined;
      const runs = await deps.prisma.run.findMany({
        where: {
          AND: [
            {
              OR: [
                { status: "queued" },
                {
                  status: { in: ["leased", "running"] },
                  leaseExpiresAt: { lte: now },
                },
              ],
            },
            ...(runCursorFilter ? [runCursorFilter] : []),
          ],
        },
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
        take: batchSize,
        select: {
          id: true,
          status: true,
          updatedAt: true,
          spaceId: true,
          userId: true,
        },
      });

      // A queued run already has a job while it waits out failure backoff.
      // Default replace would zero that job's attempts and run it now. keepExisting
      // leaves the job while attempts remain, and still replaces one that is exhausted.
      // A locked job whose worker died is never unlocked, so it is replaced: any lock
      // for a run whose lease expired, and for a queued run only a lock older than
      // a lease, since a live worker finishing a failed attempt still holds it. A run
      // waits for its computer only once it runs, so none is held back here; the scan
      // still expires takeover holds whose run is gone.
      await findRunRecoveryBlockers(deps.prisma, runs, now);
      const abandonedQueuedLockAt = new Date(now.getTime() - ABANDONED_QUEUED_LOCK_MS);
      await publishAll([
        ...runs.map((run) =>
          deps.jobs.enqueue({
            ...runContinueJob(run.id),
            keepExisting: true,
            replaceLockedBefore: run.status === "queued" ? abandonedQueuedLockAt : now,
          }),
        ),
      ]);

      const lastRun = runs.at(-1);
      runCursor =
        runs.length === batchSize && lastRun
          ? { at: lastRun.updatedAt, id: lastRun.id }
          : undefined;

      // Scheduled work drains several pages per tick, yielding between pages.
      let routinesDone = false;
      let controlsDone = false;
      for (let page = 0; page < maxPagesPerPass; page += 1) {
        if (page > 0) await setImmediate();
        if (stopping) return;
        if (page > 0 && deps.leadership && !(await deps.leadership.tryAcquire())) return;
        controlScanDeadline ??= new Date(now.getTime() + CONTROL_LOOKAHEAD_MS);
        const routineCursorFilter = routineCursor
          ? {
              OR: [
                { nextRunAt: { gt: routineCursor.at } },
                { nextRunAt: routineCursor.at, id: { gt: routineCursor.id } },
              ],
            }
          : undefined;
        const controlCursorFilter = controlCursor
          ? controlCursor.at
            ? {
                OR: [
                  { controlLeaseExpiresAt: { gt: controlCursor.at } },
                  {
                    controlLeaseExpiresAt: controlCursor.at,
                    id: { gt: controlCursor.id },
                  },
                  { controlLeaseExpiresAt: null },
                ],
              }
            : { controlLeaseExpiresAt: null, id: { gt: controlCursor.id } }
          : undefined;
        // Annotated because the cursors carried across pages make inference circular.
        const [routines, controls]: [
          Array<{ id: string; nextRunAt: Date | null }>,
          Array<{
            id: string;
            controlLeaseId: string | null;
            controlLeaseExpiresAt: Date | null;
          }>,
        ] = await Promise.all([
          routinesDone
            ? []
            : deps.prisma.routine.findMany({
                where: {
                  AND: [
                    {
                      active: true,
                      nextRunAt: { lte: new Date(now.getTime() + ROUTINE_LOOKAHEAD_MS) },
                    },
                    ...(routineCursorFilter ? [routineCursorFilter] : []),
                  ],
                },
                orderBy: [{ nextRunAt: "asc" }, { id: "asc" }],
                take: batchSize,
                select: { id: true, nextRunAt: true },
              }),
          controlsDone
            ? []
            : deps.prisma.computer.findMany({
                where: {
                  AND: [
                    { controlLeaseId: { not: null } },
                    {
                      OR: [
                        { controlLeaseExpiresAt: null },
                        { controlLeaseExpiresAt: { lte: controlScanDeadline } },
                      ],
                    },
                    ...(controlCursorFilter ? [controlCursorFilter] : []),
                  ],
                },
                orderBy: [{ controlLeaseExpiresAt: "asc" }, { id: "asc" }],
                take: batchSize,
                select: {
                  id: true,
                  controlLeaseId: true,
                  controlLeaseExpiresAt: true,
                },
              }),
        ]);
        await publishAll([
          ...routines.flatMap((routine) =>
            routine.nextRunAt
              ? [deps.jobs.enqueue(routineWakeupJob(routine.id, routine.nextRunAt))]
              : [],
          ),
          ...controls.flatMap((computer) =>
            computer.controlLeaseId
              ? [
                  scheduleComputerControlExpiry(
                    deps.jobs,
                    computer.id,
                    computer.controlLeaseId,
                    computer.controlLeaseExpiresAt ?? now,
                  ),
                ]
              : [],
          ),
        ]);

        const lastRoutine = routines.at(-1);
        routineCursor =
          routines.length === batchSize && lastRoutine?.nextRunAt
            ? { at: lastRoutine.nextRunAt, id: lastRoutine.id }
            : undefined;
        const lastControl = controls.at(-1);
        controlCursor =
          controls.length === batchSize && lastControl
            ? { at: lastControl.controlLeaseExpiresAt, id: lastControl.id }
            : undefined;
        if (!controlCursor) controlScanDeadline = undefined;
        routinesDone ||= !routineCursor;
        controlsDone ||= !controlCursor;
        if (routinesDone && controlsDone) break;
      }
    })()
      .then(() => {
        lastCompletedAt = Date.now();
      })
      .finally(() => {
        reconciling = undefined;
      });
    return reconciling;
  };
  const reconcileSafely = () => {
    void reconcileOnce().catch((error) =>
      getLogger().error("background job reconciliation", error),
    );
  };

  return {
    reconcileOnce,
    lastCompletedAt: () => lastCompletedAt,
    start() {
      if (timer) return;
      stopping = false;
      reconcileSafely();
      timer = setInterval(reconcileSafely, intervalMs);
      timer.unref?.();
    },
    async stop() {
      stopping = true;
      if (timer) clearInterval(timer);
      timer = undefined;
      await reconciling?.catch(() => undefined);
      await deps.leadership?.release();
    },
  };
}

/** Settles every publication before failing, so a retried page never overlaps one in flight. */
async function publishAll(publications: Array<Promise<unknown>>) {
  const failed = (await Promise.allSettled(publications)).find(
    (result) => result.status === "rejected",
  );
  if (failed) throw failed.reason;
}
