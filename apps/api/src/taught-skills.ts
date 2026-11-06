import { randomUUID } from "node:crypto";
import type { AgentHomeStore, JobPublisher, SandboxProvider } from "@labradoodle/adapter-kit";
import {
  createAdapterContext,
  runContinueJob,
  skillTeachingExpireJob,
  skillTeachingExpireJobKey,
} from "@labradoodle/adapter-kit";
import type {
  ComputerExecutionLease,
  TaughtSkillRow,
  TeachComputerInput,
} from "@labradoodle/adapters";
import {
  acquireComputerExecutionLease,
  appendRecordingEvent,
  ComputerBusyError,
  captureTeachingSnapshot,
  completeTeachingSession,
  emptyRecording,
  ensurePersonComputer,
  expireTaughtSkillTeaching,
  extendActiveComputerControl,
  getActiveTeachingSession,
  mapTaughtSkill,
  observeStopSnapshot,
  parsePlaybook,
  parseRecording,
  provisionComputer,
  recordTeachingInputEvent,
  releaseComputerExecutionLease,
  releaseTeachingComputerControl,
  scheduleComputerControlExpiry,
  screenLeaseIdForRun,
  teachingControlLeaseExpiresAt,
  teachingTarget,
} from "@labradoodle/adapters";
import type { Actor, TaughtSkill } from "@labradoodle/contracts";
import type { SkillPlaybook, TeachRecordingEvent } from "@labradoodle/core";
import {
  ACTIVE_RUN_STATUSES,
  buildPlaybookFromRecording,
  formatSkillRunPrompt,
  teachRecordingTtlMs,
} from "@labradoodle/core";
import type { PrismaClient, ThreadEvents } from "@labradoodle/db";
import {
  clearEndedRunState,
  createChat,
  IsolationError,
  releaseCancelledRunLeases,
} from "@labradoodle/db";
import { getLogger } from "@labradoodle/logging";
import { ORPCError } from "@orpc/server";

export interface TaughtSkillsDeps {
  prisma: PrismaClient;
  events: ThreadEvents;
  jobs: JobPublisher;
  sandbox: SandboxProvider;
  home: AgentHomeStore;
  dataDir: string;
}

/** A recorded demo is the person's who recorded it, in every workspace. */
async function getOwnedSkill(
  deps: TaughtSkillsDeps,
  actor: Actor,
  skillId: string,
): Promise<TaughtSkillRow> {
  const skill = await deps.prisma.taughtSkill.findFirst({
    where: { id: skillId, userId: actor.userId },
  });
  if (!skill) throw new IsolationError();
  return skill;
}

type TeachingTarget = Awaited<ReturnType<typeof teachingTarget>>;

/** While the person records a demo on their computer, Doodle does not run for them. */
export async function assertTeachingSendAllowed(prisma: PrismaClient, actor: Actor): Promise<void> {
  const active = await getActiveTeachingSession(prisma, actor.userId);
  if (active) {
    throw new ORPCError("CONFLICT", { message: "Stop teaching first" });
  }
}

/** The person's own runs in this workspace, which use the computer the demo needs. */
async function cancelActiveRuns(deps: TaughtSkillsDeps, actor: Actor): Promise<void> {
  const activeRuns = await deps.prisma.run.updateManyAndReturn({
    where: {
      spaceId: actor.spaceId,
      userId: actor.userId,
      status: { in: [...ACTIVE_RUN_STATUSES] },
    },
    data: { status: "cancelled", completedAt: new Date() },
    select: { id: true },
  });
  const runIds = activeRuns.map((run) => run.id);
  await clearEndedRunState(deps.prisma, runIds);
  await releaseCancelledRunLeases(deps.prisma, runIds);
  await deps.prisma.event.deleteMany({
    where: { type: "thread.progress", runId: { in: runIds } },
  });
}

async function ensureGraphicalComputer(
  deps: TaughtSkillsDeps,
  actor: Actor,
  bot: TeachingTarget,
): Promise<TeachingTarget> {
  if (bot.computer?.kind === "desktop") {
    throw new ORPCError("BAD_REQUEST", {
      message: "Teaching needs a graphical sandbox computer, not a desktop host",
    });
  }
  bot = bot.computer ? bot : { ...bot, computer: await ensurePersonComputer(deps.prisma, actor) };
  if (!bot.computer) throw new IsolationError();
  if (bot.computer.state !== "running" || !bot.computer.providerRef) {
    const ctx = createAdapterContext(actor, bot.botId, "skills.start");
    const manualRunId = `teach:${randomUUID()}`;
    let lease: ComputerExecutionLease | null;
    try {
      lease = await acquireComputerExecutionLease(deps.prisma, {
        computerId: bot.computer.id,
        runId: manualRunId,
      });
    } catch (error) {
      if (error instanceof ComputerBusyError) {
        throw new ORPCError("CONFLICT", { message: "Computer is busy" });
      }
      throw error;
    }
    const computerId = bot.computer.id;
    try {
      await getLogger().withContext({ reason: "teaching" }, () =>
        provisionComputer(deps, computerId, {
          ...ctx,
          screenLeaseId: screenLeaseIdForRun(lease, manualRunId),
        }),
      );
    } catch (error) {
      if (error instanceof ComputerBusyError) {
        throw new ORPCError("CONFLICT", { message: "Computer is busy" });
      }
      throw error;
    } finally {
      await releaseComputerExecutionLease(deps.prisma, lease);
    }
    bot = await teachingTarget(deps.prisma, actor);
  }
  if (!bot.computer?.providerRef || bot.computer.state !== "running") {
    throw new ORPCError("BAD_REQUEST", { message: "Computer must be running to teach" });
  }
  if (bot.computer.kind === "desktop") {
    throw new ORPCError("BAD_REQUEST", {
      message: "Teaching needs a graphical sandbox computer, not a desktop host",
    });
  }
  return bot;
}

async function grantTakeover(
  deps: TaughtSkillsDeps,
  actor: Actor,
  bot: TeachingTarget,
  until: Date,
): Promise<{ bot: TeachingTarget; leaseId: string }> {
  if (!bot.computer) throw new IsolationError();
  if (await extendActiveComputerControl(deps.prisma, deps.jobs, bot.computer, until)) {
    const leaseId = bot.computer.controlLeaseId;
    if (!leaseId) throw new IsolationError();
    return { bot, leaseId };
  }
  const leaseId = randomUUID();
  const expiresAt = teachingControlLeaseExpiresAt(until);
  const granted = await deps.prisma.computer.updateMany({
    where: {
      id: bot.computer.id,
      state: "running",
      // Never another person's live lease, even one taken after the check above.
      OR: [
        { controlHolder: { not: "user" } },
        { controlLeaseExpiresAt: { lte: new Date() } },
        { controlUserId: actor.userId },
        { controlUserId: null, userId: actor.userId },
      ],
    },
    data: {
      controlHolder: "user",
      controlLeaseId: leaseId,
      controlLeaseExpiresAt: expiresAt,
      controlUserId: actor.userId,
      state: "running",
    },
  });
  if (granted.count !== 1) {
    throw new ORPCError("CONFLICT", { message: "Could not take control of the computer" });
  }
  await scheduleComputerControlExpiry(deps.jobs, bot.computer.id, leaseId, expiresAt);
  return { bot, leaseId };
}

export async function expireTeachingSessionIfNeeded(deps: TaughtSkillsDeps, skillId: string) {
  return expireTaughtSkillTeaching(deps, skillId);
}

export async function stopTeachingSession(
  deps: TaughtSkillsDeps,
  actor: Actor,
  skillId: string,
): Promise<TaughtSkill> {
  await getOwnedSkill(deps, actor, skillId);
  await expireTeachingSessionIfNeeded(deps, skillId);
  const current = await deps.prisma.taughtSkill.findUniqueOrThrow({ where: { id: skillId } });
  if (current.status === "draft" || current.status === "saved") {
    await releaseTeachingComputerControl(
      deps,
      { spaceId: current.spaceId, userId: current.userId } as Actor,
      parseRecording(current.recording).controlLeaseId,
    );
    return mapTaughtSkill(current);
  }
  if (current.status !== "recording" && current.status !== "drafting") {
    throw new ORPCError("BAD_REQUEST", { message: "Teaching session is not active" });
  }
  // A recording runs in the workspace it started in.
  const owner = { ...actor, spaceId: current.spaceId };
  const stopSnapshot =
    current.status === "recording"
      ? await observeStopSnapshot(deps, owner, await teachingTarget(deps.prisma, owner))
      : undefined;
  const finalized = await completeTeachingSession(deps, owner, skillId, stopSnapshot);
  await deps.jobs.cancel(skillTeachingExpireJobKey(current.id));
  return mapTaughtSkill(finalized);
}

export function createTaughtSkillsService(deps: TaughtSkillsDeps) {
  return {
    async list(actor: Actor): Promise<TaughtSkill[]> {
      const rows = await deps.prisma.taughtSkill.findMany({
        where: { userId: actor.userId },
        orderBy: { updatedAt: "desc" },
      });
      return rows.map(mapTaughtSkill);
    },

    async get(actor: Actor, skillId: string): Promise<TaughtSkill> {
      const row = await getOwnedSkill(deps, actor, skillId);
      await expireTeachingSessionIfNeeded(deps, row.id);
      const current = await deps.prisma.taughtSkill.findUniqueOrThrow({ where: { id: skillId } });
      return mapTaughtSkill(current);
    },

    async start(actor: Actor, goal: string): Promise<TaughtSkill> {
      let bot = await teachingTarget(deps.prisma, actor);
      if (await getActiveTeachingSession(deps.prisma, actor.userId)) {
        throw new ORPCError("CONFLICT", { message: "A teaching session is already active" });
      }
      await cancelActiveRuns(deps, actor);
      bot = await ensureGraphicalComputer(deps, actor, bot);
      const startedAt = new Date();
      const expiresAt = new Date(startedAt.getTime() + teachRecordingTtlMs());
      const { leaseId } = await grantTakeover(deps, actor, bot, expiresAt);
      let row: TaughtSkillRow;
      try {
        // One recording per person: the partial unique index refuses a second.
        row = await deps.prisma.$transaction(async (tx) => {
          return tx.taughtSkill.create({
            data: {
              spaceId: actor.spaceId,
              userId: actor.userId,
              goal,
              status: "recording",
              startedAt,
              expiresAt,
              recording: { ...emptyRecording(), controlLeaseId: leaseId } as never,
              playbook: buildPlaybookFromRecording(goal, []) as never,
            },
          });
        });
      } catch (error) {
        if (error instanceof ORPCError) throw error;
        if (
          error instanceof Error &&
          "code" in error &&
          (error as { code?: string }).code === "P2002"
        ) {
          throw new ORPCError("CONFLICT", { message: "A teaching session is already active" });
        }
        throw error;
      }
      await deps.jobs.enqueue(skillTeachingExpireJob(row.id, expiresAt));
      const withSnapshot = await captureTeachingSnapshot(deps, actor, row);
      return mapTaughtSkill(withSnapshot);
    },

    async appendEvent(
      actor: Actor,
      skillId: string,
      event: TeachRecordingEvent,
    ): Promise<TaughtSkill> {
      await getOwnedSkill(deps, actor, skillId);
      await expireTeachingSessionIfNeeded(deps, skillId);
      const current = await deps.prisma.taughtSkill.findUniqueOrThrow({ where: { id: skillId } });
      if (current.status !== "recording") {
        throw new ORPCError("BAD_REQUEST", { message: "Teaching session is not recording" });
      }
      const updated = await appendRecordingEvent(deps, skillId, event, { requireRecording: true });
      if (updated.status !== "recording") {
        throw new ORPCError("BAD_REQUEST", { message: "Teaching session is not recording" });
      }
      return mapTaughtSkill(updated);
    },

    async snapshot(actor: Actor, skillId: string): Promise<TaughtSkill> {
      await getOwnedSkill(deps, actor, skillId);
      await expireTeachingSessionIfNeeded(deps, skillId);
      const current = await deps.prisma.taughtSkill.findUniqueOrThrow({ where: { id: skillId } });
      if (current.status !== "recording") {
        throw new ORPCError("BAD_REQUEST", { message: "Teaching session is not recording" });
      }
      const updated = await captureTeachingSnapshot(
        deps,
        { ...actor, spaceId: current.spaceId },
        current,
      );
      return mapTaughtSkill(updated);
    },

    stop: (actor: Actor, skillId: string) => stopTeachingSession(deps, actor, skillId),

    async updateDraft(
      actor: Actor,
      skillId: string,
      input: { name?: string; playbook: SkillPlaybook },
    ): Promise<TaughtSkill> {
      const skill = await getOwnedSkill(deps, actor, skillId);
      if (skill.status !== "draft" && skill.status !== "saved") {
        throw new ORPCError("BAD_REQUEST", { message: "Skill is not editable yet" });
      }
      const row = await deps.prisma.taughtSkill.update({
        where: { id: skill.id },
        data: {
          name: input.name ?? skill.name,
          playbook: input.playbook as never,
          status: skill.status === "saved" ? "saved" : "draft",
        },
      });
      return mapTaughtSkill(row);
    },

    async save(actor: Actor, skillId: string, name?: string): Promise<TaughtSkill> {
      const skill = await getOwnedSkill(deps, actor, skillId);
      if (skill.status !== "draft" && skill.status !== "saved") {
        throw new ORPCError("BAD_REQUEST", { message: "Finish recording before saving" });
      }
      const row = await deps.prisma.taughtSkill.update({
        where: { id: skill.id },
        data: {
          status: "saved",
          name: name ?? (skill.name || skill.goal.slice(0, 80)),
        },
      });
      return mapTaughtSkill(row);
    },

    async testRun(actor: Actor, skillId: string, prompt?: string): Promise<{ runId: string }> {
      const skill = await getOwnedSkill(deps, actor, skillId);
      if (skill.status !== "saved" && skill.status !== "draft") {
        throw new ORPCError("BAD_REQUEST", { message: "Skill must be saved or drafted first" });
      }
      // A test run goes to the person's own chat with Doodle in this workspace.
      const doodle = await deps.prisma.bot.findUnique({
        where: { spaceId: actor.spaceId },
        select: { id: true },
      });
      if (!doodle) throw new IsolationError();
      const ownChat = await deps.prisma.thread.findFirst({
        where: {
          spaceId: actor.spaceId,
          doodle: true,
          members: { every: { userId: actor.userId }, some: { userId: actor.userId } },
        },
        orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
        select: { id: true },
      });
      const threadId =
        ownChat?.id ?? (await createChat(deps.prisma, actor, { userIds: [], doodle: true })).id;
      const bot = { id: doodle.id };
      const playbook = parsePlaybook(skill.playbook);
      const taskPrompt =
        prompt ?? formatSkillRunPrompt(skill.name || skill.goal.slice(0, 80), playbook, true);
      const task = await deps.prisma.task.create({
        data: {
          spaceId: actor.spaceId,
          botId: bot.id,
          threadId,
          userId: actor.userId,
          prompt: taskPrompt,
          status: "queued",
        },
      });
      const run = await deps.prisma.run.create({
        data: {
          spaceId: actor.spaceId,
          botId: bot.id,
          threadId,
          taskId: task.id,
          userId: actor.userId,
          status: "queued",
          trigger: "skill",
        },
      });
      await deps.jobs.enqueue(runContinueJob(run.id));
      return { runId: run.id };
    },

    async remove(actor: Actor, skillId: string): Promise<{ ok: true }> {
      const skill = await getOwnedSkill(deps, actor, skillId);
      if (skill.status === "recording") {
        await deps.jobs.cancel(skillTeachingExpireJobKey(skill.id));
        await releaseTeachingComputerControl(
          deps,
          { ...actor, spaceId: skill.spaceId },
          parseRecording(skill.recording).controlLeaseId,
        );
      }
      await deps.prisma.taughtSkill.delete({ where: { id: skill.id } });
      return { ok: true as const };
    },

    expireTeachingSessionIfNeeded: (skillId: string) =>
      expireTeachingSessionIfNeeded(deps, skillId),

    async recordInput(
      actor: Actor,
      mapped: TeachComputerInput,
    ): Promise<"recorded" | "idle" | "stale"> {
      return recordTeachingInputEvent(deps, actor, mapped);
    },
  };
}
