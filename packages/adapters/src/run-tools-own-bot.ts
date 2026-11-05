import { BotSettingsValuesSchema } from "@labradoodle/contracts";
import {
  appendEventInTransaction,
  commitBotUpdate,
  InstructionConflictError,
  THREAD_LOCK_TRANSACTION_OPTIONS,
  writeBotInstructions,
} from "@labradoodle/db";
import { getLogger } from "@labradoodle/logging";
import type { ExecutorDeps } from "./executor-deps.js";
import {
  listDefaultVoices,
  prepareOwnBotSettings,
  readOwnBotSettings,
} from "./own-bot-settings.js";
import type { RunContext } from "./run-context.js";
import {
  OWN_INSTRUCTIONS_BASELINE_UNKNOWN_ERROR,
  OWN_INSTRUCTIONS_CHANGED_ERROR,
} from "./run-context.js";
import { mayOpenModelStream } from "./run-lifecycle.js";
import { publishMessage } from "./run-messages.js";
import { botSettingsDeps } from "./run-model.js";
import type { ToolHandlers } from "./run-tool-gate.js";
import { argumentGiven, parseUpdateBotPatch } from "./update-bot-patch.js";

/** Writes this bot's instructions quietly; earlier versions stay restorable in its settings. */
async function commitOwnInstructions(
  ctx: RunContext,
  input: {
    instructions: string;
    reason: string;
    previousInstructions: string | undefined;
  },
): Promise<{ ok: true } | { error: string }> {
  // A checkpoint that predates the baseline leaves the attempt without the text its rewrite
  // was built from, and an approval proposed back then stored a fresh read instead. Refuse
  // both rather than guess or overwrite what the rewrite never saw.
  if (ctx.state.ownInstructionsBaseline === undefined || input.previousInstructions === undefined)
    return { error: OWN_INSTRUCTIONS_BASELINE_UNKNOWN_ERROR };
  const { deps, run, runId, context } = ctx;
  const botId = ctx.bot.id;
  const previousInstructions = input.previousInstructions;
  const committed = await deps.prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM threads WHERE id = ${run.threadId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM runs WHERE id = ${runId} FOR UPDATE`;
    const live = await tx.run.findUnique({ where: { id: runId } });
    if (!mayOpenModelStream(live, ctx.workerId, ctx.fence, context.signal.aborted)) {
      throw new Error("Instruction update run is no longer active.");
    }
    let undoVersionId: string | null;
    try {
      undoVersionId = await writeBotInstructions(tx, {
        botId,
        instructions: input.instructions,
        reason: input.reason,
        expectedInstructions: previousInstructions,
      });
    } catch (error) {
      if (!(error instanceof InstructionConflictError)) throw error;
      // Re-reading cannot rebase this attempt, so point the model at a fresh run.
      return { error: OWN_INSTRUCTIONS_CHANGED_ERROR };
    }
    if (!undoVersionId) return null;
    const bot = await tx.bot.findUniqueOrThrow({
      where: { id: botId },
      select: { name: true },
    });
    return appendEventInTransaction(tx, {
      spaceId: run.spaceId,
      threadId: run.threadId,
      botId,
      runId,
      type: "bot.updated",
      payload: { botId, name: bot.name },
    });
  }, THREAD_LOCK_TRANSACTION_OPTIONS);
  if (committed && "error" in committed) return committed;
  if (committed)
    await deps.events
      .notify(run.threadId, committed.seq)
      .catch((error) => getLogger().error("instruction update realtime notification", error));
  ctx.state.ownInstructionsBaseline = input.instructions;
  return { ok: true };
}

/** update_bot: this bot reads and changes its own settings. */
export const ownBotTools: ToolHandlers = {
  async update_bot(ctx, call) {
    const { deps, run, bot, thread, context } = ctx;
    const { args } = call;
    // A held change (see prepareOwnBotUpdate) runs only once the owner or Auto Review approves it.
    if (typeof args.previousInstructions === "string") {
      if ((call.nextApprovedTool !== call.name && !call.bypassApproval) || !call.claimedEffect)
        return call.finish({ error: "This instruction change needs the owner's approval." });
      // A request stored before the baseline kept a fresh read as its expected text. Without
      // the marker it must not commit, whatever the resumed checkpoint restored.
      if (args.previousInstructionsFromBaseline !== true)
        return call.finish({ error: OWN_INSTRUCTIONS_BASELINE_UNKNOWN_ERROR });
      return call.finish(
        await commitOwnInstructions(ctx, {
          instructions: String(args.instructions),
          reason: String(args.reason),
          previousInstructions: args.previousInstructions,
        }),
      );
    }
    const { instructions, model, thinkingLevel, readAloud, voice, ...profile } = args;
    const modelDeps = await botSettingsDeps(deps, run);
    const live = await deps.prisma.bot.findUniqueOrThrow({
      where: { id: bot.id },
      select: {
        name: true,
        instructions: true,
        notifyOnFinish: true,
        modelProvider: true,
        modelId: true,
        thinkingLevel: true,
        autoSpeak: true,
        voiceId: true,
      },
    });
    // `instructions_offset` pages through long instructions on a read; it is not a write field.
    const instructionsOffsetArg = args.instructions_offset ?? args.instructionsOffset;
    const writeArgs = { ...args, instructions_offset: undefined, instructionsOffset: undefined };
    const read = !Object.values(writeArgs).some(argumentGiven);
    let readOffset = 0;
    if (argumentGiven(instructionsOffsetArg)) {
      const parsedOffset = Number(instructionsOffsetArg);
      if (!read)
        return call.finish({
          error: "instructions_offset only works on a read: call update_bot with no other fields.",
        });
      if (!Number.isInteger(parsedOffset) || parsedOffset < 0)
        return call.finish({ error: "instructions_offset must be a whole number of 0 or more." });
      readOffset = parsedOffset;
    }
    if (read) {
      // A read does not rebase the baseline: the text it returns has not shaped a model
      // generation yet, and a truncated read would guard on text the model never saw.
      if (readOffset > 0 && readOffset >= live.instructions.length)
        return call.finish({ error: "instructions_offset is past the end of your instructions." });
      return call.finish(await readOwnBotSettings(modelDeps, run, live, readOffset));
    }
    const settings = await prepareOwnBotSettings(
      modelDeps,
      run,
      live,
      { model, thinkingLevel, readAloud, voice },
      () => listDefaultVoices(deps, run, context),
    );
    if ("error" in settings) return call.finish(settings);
    const before = BotSettingsValuesSchema.parse(
      Object.fromEntries(
        Object.keys(settings.data).map((key) => [key, live[key as keyof typeof settings.data]]),
      ),
    );
    // The profile goes first, so a rejected field leaves everything else unchanged for a retry.
    const updated = Object.values(profile).some(argumentGiven)
      ? await updateOwnBotFromTool(deps, run, thread.id, bot, profile)
      : undefined;
    if (updated && "error" in updated) return call.finish(updated);
    if (
      Object.entries(settings.data).some(
        ([key, value]) => before[key as keyof typeof before] !== value,
      )
    ) {
      try {
        await commitBotUpdate({
          prisma: deps.prisma,
          notify: (threadId, seq) => deps.events.notify(threadId, seq),
          spaceId: run.spaceId,
          threadId: thread.id,
          botId: bot.id,
          emitBotUpdated: true,
          expectedSettings: before,
          data: settings.data,
        });
      } catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === "P2025"))
          throw error;
        return call.finish({ error: "Your settings changed meanwhile; read them and try again." });
      }
      await publishMessage(deps, run, "bot", [
        {
          kind: "ask",
          text: "Settings updated",
          status: "answered",
          settingsUpdate: { botId: bot.id, before, after: settings.data },
        },
      ]).catch((error) => getLogger().error("settings update card", error));
    }
    if (argumentGiven(instructions)) {
      const set = await commitOwnInstructions(ctx, {
        instructions: String(instructions),
        reason: "Set in chat",
        // The text the model worked from, not a fresh read: a change that landed since the
        // attempt started conflicts instead of being overwritten, and a checkpoint that
        // predates the baseline makes the commit itself refuse.
        previousInstructions: ctx.state.ownInstructionsBaseline,
      });
      if ("error" in set)
        return call.finish({
          error: `${updated || Object.keys(settings.data).length ? "Your other changes were saved, but your instructions were not: " : ""}${set.error}`,
        });
    }
    return call.finish({
      ok: true,
      ...updated,
      ...(settings.data.modelId !== undefined
        ? { model: `${settings.data.modelProvider}/${settings.data.modelId}` }
        : {}),
      ...(settings.data.thinkingLevel !== undefined
        ? { thinkingLevel: settings.data.thinkingLevel ?? "default" }
        : {}),
      ...(settings.data.autoSpeak !== undefined ? { readAloud: settings.data.autoSpeak } : {}),
      ...(settings.data.voiceId !== undefined ? { voice: settings.data.voiceId ?? "default" } : {}),
      ...(argumentGiven(instructions) ? { instructions: "updated" } : {}),
    });
  },
};

/** update_bot on the calling bot's own profile. */
async function updateOwnBotFromTool(
  deps: ExecutorDeps,
  run: { id: string; spaceId: string },
  threadId: string,
  bot: { id: string },
  args: Record<string, unknown>,
) {
  const parsed = parseUpdateBotPatch(args);
  if ("error" in parsed) return parsed;
  const updated = await deps.prisma.bot.update({
    where: { id: bot.id },
    data: parsed.patch,
    select: { id: true, name: true, notifyOnFinish: true },
  });
  try {
    await deps.events.append({
      spaceId: run.spaceId,
      threadId: threadId,
      botId: bot.id,
      runId: run.id,
      type: "bot.updated",
      payload: { botId: updated.id, name: updated.name },
    });
  } catch (error) {
    getLogger().error("bot.updated notification", error);
  }
  return {
    ok: true,
    botId: updated.id,
    name: updated.name,
    notifyOnFinish: updated.notifyOnFinish,
  };
}
