import { redactSecrets } from "@labradoodle/core";
import { publishMessage } from "./run-messages.js";
import {
  canPostLongTaskHeadsUp,
  canPublishDurableProgress,
  flushProgress,
  nextProgressNonce,
  progressSinceBudgetStart,
  publishMidTurnNarration,
  showNarrationStatus,
} from "./run-progress.js";
import type { ToolHandlers } from "./run-tool-gate.js";
import {
  clampUserProgressMessage,
  isProgressMessageTruncated,
  MID_TURN_PROGRESS_MIN_TURN_AGE_MS,
  messageUserMaxLength,
  midTurnProgressBudgetUsed,
} from "./user-progress.js";

/** Messages to the user. */
export const messagingTools: ToolHandlers = {
  async request_takeover() {
    return { ok: true };
  },
  async run_subagent(_ctx, call) {
    const { args } = call;
    return {
      ok: true,
      result: String(args.task ?? "done."),
    };
  },
  async message_user(ctx, call) {
    const { deps, run } = ctx;
    const { args } = call;
    const { reply } = ctx.state;
    const rawMessage = redactSecrets(String(args.message ?? ""), ctx.secrets);
    const maxLength = messageUserMaxLength();
    const text = clampUserProgressMessage(rawMessage, maxLength);
    if (!text) return call.finish({ error: "message is required" });
    const truncated = isProgressMessageTruncated(rawMessage, maxLength);
    await flushProgress(ctx);
    // Text written before an answer to the person's mid-task message doesn't use up the
    // allowance meant for that answer.
    const answering = reply.steeringReplyPending;
    reply.steeringReplyPending = false;
    await showNarrationStatus(ctx, await publishMidTurnNarration(ctx));
    // A mid-task message handled meanwhile may have granted a new allowance; keep it.
    reply.steeringReplyPending ||= answering;
    if (!canPublishDurableProgress(reply) && !canPostLongTaskHeadsUp(ctx)) {
      return call.finish({
        ok: true,
        note: midTurnProgressBudgetUsed(progressSinceBudgetStart(reply))
          ? "This update was not posted. The chat already has enough interim messages for this run. Do not send more progress updates — keep working and put everything in your final reply."
          : `This update was not posted because the turn just started. Keep working and put anything the person needs in your final reply. Once the turn has run ${MID_TURN_PROGRESS_MIN_TURN_AGE_MS / 1000} seconds, a later update can be posted.`,
      });
    }
    await publishMessage(deps, run, "bot", [{ kind: "text", text }], true, nextProgressNonce(ctx));
    reply.midTurnUserTexts.push(text);
    reply.publishedMidTurnUserMessage = true;
    return call.finish(
      truncated
        ? {
            ok: true,
            truncated: true,
            note: `This progress update was cut off at ${maxLength} characters and the user only saw the truncated version above — it did NOT deliver your full content. message_user is for short interim beats only, never the final answer. Put your complete answer in your normal final reply instead of relying on this truncated update.`,
          }
        : { ok: true },
    );
  },
};
