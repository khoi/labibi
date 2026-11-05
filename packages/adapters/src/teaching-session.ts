import type {
  AdapterContext,
  ComputerInput,
  ControlLeaseRef,
  JobPublisher,
  SandboxProvider,
} from "@labradoodle/adapter-kit";
import { computerControlExpireJobKey, skillTeachingExpireJobKey } from "@labradoodle/adapter-kit";
import type { Actor, TaughtSkill } from "@labradoodle/contracts";
import type { SkillPlaybook, TeachRecordingEvent, TeachSnapshot } from "@labradoodle/core";
import {
  buildPlaybookFromRecording,
  computerInputForDomKey,
  sanitizeTeachRecordingEvent,
} from "@labradoodle/core";
import type { Computer, PrismaClient, ThreadEvents } from "@labradoodle/db";
import { revokeScreenControl } from "./computer-control.js";
import { scheduleComputerSleep } from "./computer-idle.js";
import { toComputerRef } from "./computer-support.js";
import { findPersonComputer } from "./person-computer.js";

export type TaughtSkillRow = {
  id: string;
  spaceId: string;
  userId: string;
  name: string;
  goal: string;
  status: string;
  playbook: unknown;
  recording: unknown;
  startedAt: Date | null;
  expiresAt: Date | null;
  stoppedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type TeachRecording = {
  events: TeachRecordingEvent[];
  snapshots: TeachSnapshot[];
  controlLeaseId?: string;
};

export type TeachComputerInput = (
  | ComputerInput
  | {
      kind: "scroll";
      direction: "up" | "down" | "left" | "right";
      amount?: number;
      x?: number;
      y?: number;
    }
) & {
  sensitive?: boolean;
  skillId?: string;
};

export interface TeachingSessionDeps {
  prisma: PrismaClient;
  events: ThreadEvents;
  jobs: JobPublisher;
  sandbox: SandboxProvider;
}

export function emptyRecording(): TeachRecording {
  return { events: [], snapshots: [] };
}

export function parseRecording(value: unknown): TeachRecording {
  if (!value || typeof value !== "object") return emptyRecording();
  const record = value as Partial<TeachRecording>;
  return {
    events: Array.isArray(record.events) ? (record.events as TeachRecordingEvent[]) : [],
    snapshots: Array.isArray(record.snapshots) ? (record.snapshots as TeachSnapshot[]) : [],
    controlLeaseId: typeof record.controlLeaseId === "string" ? record.controlLeaseId : undefined,
  };
}

export function parsePlaybook(value: unknown): SkillPlaybook {
  if (!value || typeof value !== "object") {
    return buildPlaybookFromRecording("", []);
  }
  const record = value as Partial<SkillPlaybook>;
  return {
    whenToUse: String(record.whenToUse ?? ""),
    inputs: Array.isArray(record.inputs) ? record.inputs.map(String) : [],
    steps: Array.isArray(record.steps) ? record.steps.map(String) : [],
    howToCheck: String(record.howToCheck ?? ""),
    whatToReturn: String(record.whatToReturn ?? ""),
    approvalBoundaries: String(record.approvalBoundaries ?? ""),
    failureHandling: String(record.failureHandling ?? ""),
  };
}

export function mapTaughtSkill(row: TaughtSkillRow): TaughtSkill {
  return {
    id: row.id,
    name: row.name,
    goal: row.goal,
    status: row.status as TaughtSkill["status"],
    playbook: parsePlaybook(row.playbook),
    recording: parseRecording(row.recording),
    startedAt: row.startedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    stoppedAt: row.stoppedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function computerContext(actor: Actor, botId: string, operationId: string): AdapterContext {
  return {
    operationId,
    traceId: operationId,
    spaceId: actor.spaceId,
    userId: actor.userId,
    botId,
    signal: new AbortController().signal,
  };
}

/** The demo this person is recording, wherever they started it; one at a time. */
export async function getActiveTeachingSession(prisma: PrismaClient, userId: string) {
  return prisma.taughtSkill.findFirst({ where: { userId, status: "recording" } });
}

/** A recording runs on its person's computer in its workspace, with Doodle's screen there. */
export async function teachingTarget(
  prisma: PrismaClient,
  owner: { spaceId: string; userId: string },
): Promise<{ botId: string; computer: Computer | null }> {
  const [doodle, computer] = await Promise.all([
    prisma.bot.findUnique({ where: { spaceId: owner.spaceId }, select: { id: true } }),
    findPersonComputer(prisma, owner),
  ]);
  return { botId: doodle?.id ?? "default", computer };
}

function recordingEventKey(event: TeachRecordingEvent): string {
  return JSON.stringify(event);
}

async function mutateRecording(
  deps: TeachingSessionDeps,
  skillId: string,
  mutate: (recording: TeachRecording) => { recording: TeachRecording; changed: boolean },
  options?: { requireRecording?: boolean },
): Promise<TaughtSkillRow> {
  return deps.prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM taught_skills WHERE id = ${skillId} FOR UPDATE`;
    const skill = await tx.taughtSkill.findUniqueOrThrow({ where: { id: skillId } });
    if (options?.requireRecording !== false && skill.status !== "recording") {
      return skill;
    }
    if (skill.expiresAt && skill.expiresAt.getTime() <= Date.now()) {
      return skill;
    }
    const current = parseRecording(skill.recording);
    const next = mutate(current);
    if (!next.changed) return skill;
    return tx.taughtSkill.update({
      where: { id: skillId },
      data: { recording: next.recording as never },
    });
  });
}

export async function observeStopSnapshot(
  deps: TeachingSessionDeps,
  actor: Actor,
  target: { botId: string; computer: { providerRef: string | null } | null },
): Promise<TeachSnapshot | undefined> {
  if (!target.computer?.providerRef) return undefined;
  try {
    const observation = await deps.sandbox.observe(
      toComputerRef(target.computer as never),
      computerContext(actor, target.botId, "skills.snapshot"),
    );
    const summary =
      typeof observation === "object" &&
      observation &&
      "activeWindow" in observation &&
      observation.activeWindow &&
      typeof observation.activeWindow === "object" &&
      "title" in observation.activeWindow
        ? String((observation.activeWindow as { title?: string }).title ?? "screen captured")
        : "screen captured";
    return { at: new Date().toISOString(), summary };
  } catch {
    return undefined;
  }
}

async function finalizeTeachingRecording(
  deps: TeachingSessionDeps,
  skillId: string,
  stopSnapshot?: TeachSnapshot,
): Promise<TaughtSkillRow> {
  return deps.prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM taught_skills WHERE id = ${skillId} FOR UPDATE`;
    const skill = await tx.taughtSkill.findUniqueOrThrow({ where: { id: skillId } });
    if (skill.status === "draft" || skill.status === "saved") return skill;
    if (skill.status !== "recording" && skill.status !== "drafting") {
      throw new Error("Teaching session is not active");
    }
    const recording = parseRecording(skill.recording);
    if (stopSnapshot) {
      recording.snapshots.push(stopSnapshot);
      recording.events.push({
        at: stopSnapshot.at,
        kind: "snapshot",
        summary: stopSnapshot.summary,
      });
    }
    const playbook = buildPlaybookFromRecording(skill.goal, recording.events, recording.snapshots);
    return tx.taughtSkill.update({
      where: { id: skillId },
      data: {
        status: "draft",
        recording: recording as never,
        playbook: playbook as never,
        stoppedAt: new Date(),
      },
    });
  });
}

export async function appendRecordingEvent(
  deps: TeachingSessionDeps,
  skillId: string,
  event: TeachRecordingEvent,
  options?: { requireRecording?: boolean },
): Promise<TaughtSkillRow> {
  return mutateRecording(
    deps,
    skillId,
    (recording) => {
      const stored = sanitizeTeachRecordingEvent(event);
      const key = recordingEventKey(stored);
      if (recording.events.some((existing) => recordingEventKey(existing) === key)) {
        return { recording, changed: false };
      }
      recording.events.push(stored);
      return { recording, changed: true };
    },
    options,
  );
}

/** Gives the person's computer back to Doodle once their recording ends. */
export async function releaseTeachingComputerControl(
  deps: TeachingSessionDeps,
  actor: Actor,
  expectedLeaseId?: string | null,
): Promise<void> {
  const { botId, computer } = await teachingTarget(deps.prisma, actor);
  if (computer?.controlHolder !== "user" || !computer.controlLeaseId) return;
  if (!expectedLeaseId || computer.controlLeaseId !== expectedLeaseId) return;
  const leaseId = computer.controlLeaseId;
  await revokeScreenControl(
    deps,
    computer,
    computerContext(actor, botId, "skills.release"),
    leaseId,
  );
  await deps.jobs.cancel(computerControlExpireJobKey(computer.id, leaseId));
  await deps.events.finalizeComputerControlRelease({
    spaceId: actor.spaceId,
    computerId: computer.id,
    runId: computer.controlRunId,
    leaseId,
    holder: "bot",
    reason: "released",
  });
  await scheduleComputerSleep(deps.jobs, computer.id);
}

export async function completeTeachingSession(
  deps: TeachingSessionDeps,
  actor: Actor,
  skillId: string,
  stopSnapshot?: TeachSnapshot,
): Promise<TaughtSkillRow> {
  const finalized = await finalizeTeachingRecording(deps, skillId, stopSnapshot);
  await releaseTeachingComputerControl(
    deps,
    actor,
    parseRecording(finalized.recording).controlLeaseId,
  );
  return finalized;
}

export async function expireTaughtSkillTeaching(
  deps: TeachingSessionDeps,
  skillId: string,
): Promise<TaughtSkillRow | null> {
  const skill = await deps.prisma.taughtSkill.findUnique({ where: { id: skillId } });
  if (!skill) return null;
  const actor = { spaceId: skill.spaceId, userId: skill.userId } as Actor;
  if (skill.status !== "recording") {
    const leaseId = parseRecording(skill.recording).controlLeaseId;
    if (leaseId) await releaseTeachingComputerControl(deps, actor, leaseId);
    return skill;
  }
  if (!skill.expiresAt || skill.expiresAt.getTime() > Date.now()) {
    return skill;
  }
  const stopSnapshot = await observeStopSnapshot(
    deps,
    actor,
    await teachingTarget(deps.prisma, actor),
  );
  const finalized = await completeTeachingSession(deps, actor, skill.id, stopSnapshot);
  await deps.jobs.cancel(skillTeachingExpireJobKey(skill.id));
  return finalized;
}

export async function applyTeachingDesktopInput(
  sandbox: SandboxProvider,
  computer: {
    homeKey: string;
    kind: string;
    providerRef: string | null;
    controlLeaseId: string | null;
  },
  mapped: TeachComputerInput,
  context: AdapterContext,
): Promise<void> {
  if (!computer.providerRef) return;
  const lease: ControlLeaseRef = {
    leaseId: computer.controlLeaseId ?? "lease",
    holder: "user",
    fence: 0,
  };
  if (mapped.kind === "scroll") {
    await sandbox.act(
      toComputerRef(computer),
      {
        actions: [
          {
            kind: "scroll",
            direction: mapped.direction,
            amount: mapped.amount,
            ...(mapped.x !== undefined && mapped.y !== undefined
              ? { x: mapped.x, y: mapped.y }
              : {}),
          },
        ],
        observe: false,
      },
      context,
    );
    return;
  }
  const { skillId: _skillId, ...desktop } = mapped;
  const input: ComputerInput =
    desktop.kind === "key" && desktop.key && !desktop.modifiers?.length
      ? computerInputForDomKey(desktop.key)
      : desktop;
  await sandbox.sendInput(toComputerRef(computer), input, lease, context);
}

function protectedInputMissesRecording(
  mapped: TeachComputerInput,
  activeSkillId: string | undefined,
): boolean {
  return mapped.sensitive === true && Boolean(mapped.skillId) && activeSkillId !== mapped.skillId;
}

export async function recordTeachingInputEvent(
  deps: TeachingSessionDeps,
  actor: Actor,
  mapped: TeachComputerInput,
): Promise<"recorded" | "idle" | "stale"> {
  const active = await getActiveTeachingSession(deps.prisma, actor.userId);
  // A recording runs in the workspace it started in.
  const skill = active?.spaceId === actor.spaceId ? active : null;
  // Protected input names the recording it was queued for, so a later one cannot receive it.
  if (protectedInputMissesRecording(mapped, skill?.id)) return "stale";
  if (!skill) return "idle";
  if (skill.expiresAt && skill.expiresAt.getTime() <= Date.now()) {
    await expireTaughtSkillTeaching(deps, skill.id);
    return "stale";
  }
  const event = sanitizeTeachRecordingEvent({
    at: new Date().toISOString(),
    kind: mapped.kind === "scroll" ? "scroll" : mapped.kind,
    ...(mapped.sensitive ? { sensitive: true as const } : {}),
    ...(mapped.kind === "key"
      ? { key: mapped.key }
      : mapped.kind === "clipboard"
        ? { text: mapped.text }
        : mapped.kind === "scroll"
          ? {
              type: mapped.direction,
              text: String(mapped.amount ?? 3),
              ...(mapped.x !== undefined && mapped.y !== undefined
                ? { x: mapped.x, y: mapped.y }
                : {}),
            }
          : {
              x: mapped.x,
              y: mapped.y,
              button: mapped.button,
              type: mapped.type,
            }),
  });
  const prepared = await deps.prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM taught_skills WHERE id = ${skill.id} FOR UPDATE`;
    const current = await tx.taughtSkill.findUniqueOrThrow({ where: { id: skill.id } });
    if (current.status !== "recording") return { kind: "stale" as const };
    if (current.expiresAt && current.expiresAt.getTime() <= Date.now()) {
      return { kind: "expired" as const };
    }
    return { kind: "ready" as const };
  });
  if (prepared.kind === "expired") {
    await expireTaughtSkillTeaching(deps, skill.id);
    return "stale";
  }
  if (prepared.kind === "stale") return "stale";
  const target = await teachingTarget(deps.prisma, actor);
  if (target.computer?.providerRef) {
    // The row lock above does not cover sandbox IO. Only protected input is
    // bound to a recording, so ordinary events skip this extra read.
    if (mapped.sensitive === true && mapped.skillId) {
      const current = await getActiveTeachingSession(deps.prisma, actor.userId);
      if (protectedInputMissesRecording(mapped, current?.id)) return "stale";
    }
    await applyTeachingDesktopInput(
      deps.sandbox,
      target.computer,
      mapped,
      computerContext(actor, target.botId, "input"),
    );
  }
  const recorded = await deps.prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM taught_skills WHERE id = ${skill.id} FOR UPDATE`;
    const current = await tx.taughtSkill.findUniqueOrThrow({ where: { id: skill.id } });
    if (current.status !== "recording") return "stale" as const;
    if (current.expiresAt && current.expiresAt.getTime() <= Date.now()) return "expired" as const;
    const recording = parseRecording(current.recording);
    recording.events.push(event);
    await tx.taughtSkill.update({
      where: { id: skill.id },
      data: { recording: recording as never },
    });
    return "recorded" as const;
  });
  if (recorded === "expired") {
    await expireTaughtSkillTeaching(deps, skill.id);
    return "stale";
  }
  return recorded;
}

export async function captureTeachingSnapshot(
  deps: TeachingSessionDeps,
  actor: Actor,
  skill: TaughtSkillRow,
): Promise<TaughtSkillRow> {
  const snapshot = await observeStopSnapshot(deps, actor, await teachingTarget(deps.prisma, actor));
  if (!snapshot) return skill;
  return mutateRecording(deps, skill.id, (recording) => {
    recording.snapshots.push(snapshot);
    recording.events.push({ at: snapshot.at, kind: "snapshot", summary: snapshot.summary });
    return { recording, changed: true };
  });
}
