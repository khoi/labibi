import {
  desktopGuardApplies,
  desktopProtectionGuardMessage,
  protectedComputerLifecycleRefusal,
} from "./desktop-command-guard.js";
import type { RunContext } from "./run-context.js";
import type { ToolHandlers } from "./run-tool-gate.js";
import {
  cancelScheduleFromTool,
  commandWatchFromTool,
  compactScheduleInput,
  createScheduleFromTool,
  isScheduleValueProvided,
  listSchedulesFromTool,
  scheduleCreateError,
  scheduleCreateFields,
  updateScheduleFromTool,
} from "./schedule-tools.js";
import {
  skillCreateFromTool,
  skillDeleteFromTool,
  skillReadFromTool,
  skillUpdateFromTool,
} from "./skill-tools.js";
import { taskCatalogFromTool } from "./task-catalog.js";

/** A command watch may not run what the desktop guard keeps the bot from running itself. */
function commandWatchGuardError(ctx: RunContext, watch: unknown): string | undefined {
  const command = commandWatchFromTool(watch);
  const refusal = command === undefined ? undefined : protectedComputerLifecycleRefusal(command);
  return desktopGuardApplies(ctx.computer) && refusal
    ? desktopProtectionGuardMessage(refusal)
    : undefined;
}

/**
 * What `schedule_create` refuses before saving anything. Checked before the approval gate,
 * so a routine that cannot be saved returns its error and shows no card; the handler checks again.
 */
export async function scheduleCreateRefusal(
  ctx: RunContext,
  args: Record<string, unknown>,
): Promise<{ error: string } | undefined> {
  const { deps, run, bot, thread } = ctx;
  const error =
    commandWatchGuardError(ctx, args.watch) ??
    (await scheduleCreateError(deps.prisma, {
      spaceId: run.spaceId,
      botId: bot.id,
      userId: run.userId,
      threadId: thread.id,
      ...scheduleCreateFields(args),
    }));
  return error ? { error } : undefined;
}

/** The task catalog, schedules and skills. */
export const taskTools: ToolHandlers = {
  async task_catalog(ctx) {
    const { deps, run, bot, thread } = ctx;
    return taskCatalogFromTool(deps, {
      spaceId: run.spaceId,
      botId: bot.id,
      userId: run.userId,
      threadId: thread.id,
      tools: ctx.tools.offered,
    });
  },
  async schedule_create(ctx, call) {
    const { deps, run, bot, thread } = ctx;
    const { args } = call;
    const refusal = commandWatchGuardError(ctx, args.watch);
    if (refusal) return call.finish({ error: refusal });
    const created = await createScheduleFromTool(deps, {
      spaceId: run.spaceId,
      botId: bot.id,
      userId: run.userId,
      threadId: thread.id,
      ...scheduleCreateFields(args),
    });
    return call.finish(created);
  },
  async schedule_update(ctx, call) {
    const { deps, run, bot, thread } = ctx;
    const { args } = call;
    return call.finish(
      await updateScheduleFromTool(deps, {
        spaceId: run.spaceId,
        botId: bot.id,
        userId: run.userId,
        threadId: thread.id,
        scopeThreadId: thread.id,
        routineId: String(args.routineId ?? ""),
        name: isScheduleValueProvided(args.name) ? String(args.name) : undefined,
        prompt: isScheduleValueProvided(args.prompt) ? String(args.prompt) : undefined,
        active: typeof args.active === "boolean" ? args.active : undefined,
        timezone: isScheduleValueProvided(args.timezone) ? String(args.timezone) : undefined,
        schedule: compactScheduleInput({
          cron: args.cron,
          every: args.every,
          unit: args.unit,
          runAt: args.runAt,
          delayMinutes: args.delayMinutes,
          delaySeconds: args.delaySeconds,
          startAt: args.startAt,
        }),
      }),
    );
  },
  async schedule_list(ctx) {
    const { deps, run, bot, thread } = ctx;
    return listSchedulesFromTool(deps, {
      spaceId: run.spaceId,
      botId: bot.id,
      threadId: thread.id,
    });
  },
  async schedule_cancel(ctx, call) {
    const { deps, run, bot, thread } = ctx;
    const { args } = call;
    const cancelled = await cancelScheduleFromTool(deps, {
      spaceId: run.spaceId,
      botId: bot.id,
      threadId: thread.id,
      routineId: args.routineId ? String(args.routineId) : undefined,
      name: args.name ? String(args.name) : undefined,
    });
    return call.finish(cancelled);
  },
  async skill_read(ctx, call) {
    const { deps, run } = ctx;
    const { args } = call;
    return skillReadFromTool(
      deps.prisma,
      {
        spaceId: run.spaceId,
        userId: run.userId,
      },
      {
        name: args.name ? String(args.name) : undefined,
        skillId: args.skillId ? String(args.skillId) : undefined,
        file: args.file ? String(args.file) : undefined,
      },
    );
  },
  async skill_create(ctx, call) {
    const { deps, run } = ctx;
    const { args } = call;
    return call.finish(
      await skillCreateFromTool(
        deps.prisma,
        {
          spaceId: run.spaceId,
          userId: run.userId,
        },
        {
          name: args.name ? String(args.name) : undefined,
          description: args.description ? String(args.description) : undefined,
          body: args.body ? String(args.body) : undefined,
          content: args.content ? String(args.content) : undefined,
        },
      ),
    );
  },
  async skill_update(ctx, call) {
    const { deps, run } = ctx;
    const { args } = call;
    return call.finish(
      await skillUpdateFromTool(
        deps.prisma,
        {
          spaceId: run.spaceId,
          userId: run.userId,
        },
        {
          name: args.name ? String(args.name) : undefined,
          skillId: args.skillId ? String(args.skillId) : undefined,
          newName: args.newName ? String(args.newName) : undefined,
          description: args.description !== undefined ? String(args.description) : undefined,
          body: args.body !== undefined ? String(args.body) : undefined,
          content: args.content ? String(args.content) : undefined,
        },
      ),
    );
  },
  async skill_delete(ctx, call) {
    const { deps, run } = ctx;
    const { args } = call;
    return call.finish(
      await skillDeleteFromTool(
        deps.prisma,
        {
          spaceId: run.spaceId,
          userId: run.userId,
        },
        {
          name: args.name ? String(args.name) : undefined,
          skillId: args.skillId ? String(args.skillId) : undefined,
        },
      ),
    );
  },
};
