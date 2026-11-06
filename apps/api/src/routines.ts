import { routineWakeupJob } from "@labradoodle/adapter-kit";
import {
  parseRoutineWatch,
  parseRoutineWatchState,
  routineRunModelPin,
} from "@labradoodle/adapters";
import type { Actor, CreateRoutineInput, Routine } from "@labradoodle/contracts";
import { canonicalPiProviderId } from "@labradoodle/contracts";
import {
  hasMixedOneShotSchedule,
  isOneShotRoutineCrons,
  nextCronDateAcrossStrict,
  routineScheduleDelayed,
} from "@labradoodle/core";
import type { Prisma, PrismaClient } from "@labradoodle/db";
import { IsolationError, requireChatMember } from "@labradoodle/db";
import { ORPCError } from "@orpc/server";
import type { RouterDeps } from "./router.js";

export function assertRoutineSchedule(input: CreateRoutineInput): void {
  if (hasMixedOneShotSchedule(input.crons)) {
    throw new ORPCError("BAD_REQUEST", {
      message: "A one-time schedule can't be combined with other schedules.",
    });
  }
  if (input.active && isOneShotRoutineCrons(input.crons)) {
    throw new ORPCError("BAD_REQUEST", {
      message: "One-shot schedules must be created from chat.",
    });
  }
}

export function routineNextRunAt(input: CreateRoutineInput): Date | null {
  // Validate every recurring cron even when inactive; @once and webhook-only have no next date.
  let nextRunAt: Date | null = null;
  if (input.crons.length > 0 && !isOneShotRoutineCrons(input.crons)) {
    const computedNextRunAt = nextRoutineDate(input.crons, input.timezone);
    nextRunAt = input.active ? computedNextRunAt : null;
  }
  // A change trigger takes its first reading right away; that reading is the baseline.
  if (input.watch && input.active) nextRunAt = firstWatchCheck();
  return nextRunAt;
}

export function routineRowData(
  actor: Actor,
  input: CreateRoutineInput,
  nextRunAt: Date | null,
  doodleId: string,
) {
  return {
    spaceId: actor.spaceId,
    botId: doodleId,
    threadId: input.threadId,
    userId: actor.userId,
    name: input.name,
    prompt: input.prompt,
    crons: input.crons,
    timezone: input.timezone,
    notify: input.notify,
    active: input.active,
    webhookEnabled: input.webhookEnabled,
    githubEnabled: input.githubEnabled,
    modelProvider: input.modelProvider,
    modelId: input.modelId,
    thinkingLevel: input.thinkingLevel,
    ...(input.watch ? { watch: input.watch as Prisma.InputJsonValue } : {}),
    nextRunAt,
  };
}

export function nextRoutineDate(crons: string[], timezone: string): Date {
  let next: Date | null;
  try {
    next = nextCronDateAcrossStrict(crons, new Date(), timezone);
  } catch {
    throw new ORPCError("BAD_REQUEST", { message: "Enter a valid cron expression." });
  }
  if (!next) throw new ORPCError("BAD_REQUEST", { message: "Enter a valid cron expression." });
  return next;
}

/** A new or re-armed watch takes its first reading a moment from now. */
export function firstWatchCheck(): Date {
  return new Date(Date.now() + 2_000);
}

export function mapRoutine(row: {
  id: string;
  threadId: string;
  webhookSecretId: string | null;
  name: string;
  prompt: string;
  crons: string[];
  timezone: string;
  active: boolean;
  notify: boolean;
  webhookEnabled: boolean;
  githubEnabled: boolean;
  modelProvider: string | null;
  modelId: string | null;
  thinkingLevel: string | null;
  watch: unknown;
  watchState: unknown;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  createdAt: Date;
}): Routine {
  return {
    id: row.id,
    threadId: row.threadId,
    name: row.name,
    prompt: row.prompt,
    crons: row.crons,
    timezone: row.timezone,
    active: row.active,
    notify: row.notify,
    webhookEnabled: row.webhookEnabled,
    webhookConfigured: Boolean(row.webhookSecretId),
    githubEnabled: row.githubEnabled,
    modelProvider: row.modelProvider ? canonicalPiProviderId(row.modelProvider) : null,
    modelId: row.modelId ?? null,
    thinkingLevel: (row.thinkingLevel as Routine["thinkingLevel"]) ?? null,
    watch: parseRoutineWatch(row.watch),
    watchState: parseRoutineWatchState(row.watchState),
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    nextRunAt: row.nextRunAt?.toISOString() ?? null,
    scheduleDelayed: routineScheduleDelayed({
      active: row.active,
      nextRunAt: row.nextRunAt?.getTime() ?? null,
    }),
    createdAt: row.createdAt.toISOString(),
  };
}

/** A chat's routines; anyone in it may change one (see routines.update). */
export async function listRoutinesDto(deps: RouterDeps, actor: Actor, threadId: string) {
  const rows = await deps.prisma.routine.findMany({
    where: { threadId, spaceId: actor.spaceId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map(mapRoutine);
}

/** Routines belong to a chat Doodle is in, which the caller is in too. */
export async function requireRoutineChat(prisma: PrismaClient, actor: Actor, threadId: string) {
  const chat = await requireChatMember(prisma, actor, threadId);
  if (!chat.doodle) {
    throw new ORPCError("BAD_REQUEST", { message: "Add Doodle to this chat first." });
  }
  const doodle = await prisma.bot.findUnique({
    where: { spaceId: actor.spaceId },
    select: { id: true },
  });
  if (!doodle) throw new IsolationError();
  return { threadId: chat.id, doodleId: doodle.id };
}

export function createRoutineAnnouncer(deps: RouterDeps) {
  const announceRoutine = async (
    actor: Actor,
    row: Awaited<ReturnType<typeof deps.prisma.routine.create>>,
  ) => {
    await deps.events.append({
      spaceId: actor.spaceId,
      threadId: row.threadId,
      botId: row.botId,
      type: "routine.created",
      payload: { name: row.name },
    });
    if (row.active && row.nextRunAt) {
      await deps.jobs.enqueue(routineWakeupJob(row.id, row.nextRunAt));
    }
  };
  return announceRoutine;
}

/** A routine of a chat the caller is in, with Doodle there: the check behind every test run. */
export async function routineTestTarget(prisma: PrismaClient, actor: Actor, routineId: string) {
  const routine = await prisma.routine.findFirst({
    where: { id: routineId, spaceId: actor.spaceId },
  });
  if (!routine) throw new IsolationError();
  const chat = await requireRoutineChat(prisma, actor, routine.threadId);
  return { routine, botId: chat.doodleId, threadId: chat.threadId };
}

/**
 * The run key of a test run. The caller's id keeps another member from ever taking it, and the
 * previous release wrote `routine-test:<client nonce>` as given, so it can never write this prefix.
 */
export function routineTestRunNonce(actor: Actor, clientNonce: string): string {
  return `routine-run:${actor.userId}:${clientNonce}`;
}

/** Task + run commit together; a run already saved under the nonce fails the insert. */
export async function createRoutineTestRun(
  tx: Prisma.TransactionClient,
  actor: Actor,
  target: Awaited<ReturnType<typeof routineTestTarget>>,
  prompt: string,
  nonce: string | undefined,
) {
  const { routine, botId, threadId } = target;
  const task = await tx.task.create({
    data: {
      spaceId: actor.spaceId,
      botId,
      threadId,
      userId: actor.userId,
      prompt,
      status: "queued",
    },
  });
  const currentModel = await tx.routine.findUnique({
    where: { id: routine.id },
    select: { modelProvider: true, modelId: true, thinkingLevel: true },
  });
  if (!currentModel) throw new IsolationError();
  return tx.run.create({
    data: {
      spaceId: actor.spaceId,
      botId,
      threadId,
      taskId: task.id,
      userId: actor.userId,
      status: "queued",
      trigger: "routine",
      routineId: routine.id,
      ...routineRunModelPin(currentModel),
      clientNonce: nonce,
    },
    select: { id: true, status: true },
  });
}
