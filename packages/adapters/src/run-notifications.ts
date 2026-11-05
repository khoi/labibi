import type { NotificationMessage, NotificationProvider } from "@labradoodle/adapter-kit";
import type { MessageBlock } from "@labradoodle/contracts";
import {
  isBackgroundRunTrigger,
  plainTextFromMarkdown,
  redactSecrets,
  truncatedPlainText,
  truncatePlainText,
} from "@labradoodle/core";
import type { PrismaClient, ThreadEvents } from "@labradoodle/db";
import { countUnreadInboxChats } from "@labradoodle/db";
import { getLogger } from "@labradoodle/logging";
import { doodleNotificationIdentity } from "./notification-identity.js";

const COMPLETION_NOTIFICATION_MAX_CHARS = 180;

export type ChatNotifier = {
  prisma: PrismaClient;
  notifications?: NotificationProvider;
  events?: Pick<ThreadEvents, "publishChatAlert">;
};

/** Kinds a muted chat stays quiet for; the others ask something of one person. */
const MUTED_KINDS = new Set<NotificationMessage["kind"]>(["message", "completion"]);

/**
 * Alerts people in a chat, in open apps and by push: the people in `to`, else everyone in it but
 * `except`. Whoever muted the chat gets none of its new messages.
 */
export async function notifyChat(
  deps: ChatNotifier,
  input: {
    spaceId: string;
    threadId: string;
    to?: readonly string[];
    except?: string;
    message: NotificationMessage;
  },
  options: { retryOnFailure?: boolean } = {},
) {
  if (!deps.notifications && !deps.events?.publishChatAlert) return;
  const recipients = await deps.prisma.threadMember
    .findMany({
      where: {
        threadId: input.threadId,
        spaceId: input.spaceId,
        AND: [
          input.to ? { userId: { in: [...input.to] } } : {},
          input.except ? { userId: { not: input.except } } : {},
        ],
        ...(MUTED_KINDS.has(input.message.kind) ? { muted: false } : {}),
      },
      select: { userId: true },
    })
    .catch((error) => {
      if (options.retryOnFailure) throw error;
      getLogger().error("chat notification recipients", error);
      return [];
    });
  await Promise.all(
    recipients.map(({ userId }) =>
      notifyPerson(deps, { spaceId: input.spaceId, userId }, input.message, options),
    ),
  );
}

async function notifyPerson(
  deps: ChatNotifier,
  person: { spaceId: string; userId: string },
  message: NotificationMessage,
  options: { retryOnFailure?: boolean },
) {
  publishChatAlert(deps.events, person, message);
  if (!deps.notifications) return;
  // The icon shows what the inbox shows: unread chats across the person's workspaces. Without
  // a count the push leaves the badge as it is.
  const badge = await countUnreadInboxChats(deps.prisma, person).catch((error) => {
    getLogger().error("unread chat count", error);
    return undefined;
  });
  await deps.notifications
    .send(
      { ...message, ...(badge === undefined ? {} : { badge }) },
      {
        operationId: "notify",
        traceId: message.threadId,
        spaceId: person.spaceId,
        userId: person.userId,
        signal: new AbortController().signal,
      },
    )
    .catch((error) => {
      if (options.retryOnFailure) throw error;
      getLogger().error("chat notification", error);
    });
}

/**
 * What Doodle did in a run, for the people it concerns. Its reply goes to the person who asked,
 * or for a routine to everyone in the chat when the routine notifies. Questions, takeovers and
 * failures go to the person who asked.
 */
export async function notifyRun(
  deps: ChatNotifier,
  run: {
    spaceId: string;
    userId: string;
    threadId: string;
    trigger: string;
    routineId?: string | null;
  },
  message: Omit<NotificationMessage, "sender">,
  options: { retryOnFailure?: boolean } = {},
) {
  if (isBackgroundRunTrigger(run.trigger) && message.kind !== "help" && message.kind !== "takeover")
    return;
  const routine = run.routineId
    ? await deps.prisma.routine
        .findUnique({ where: { id: run.routineId }, select: { notify: true } })
        .catch(() => null)
    : null;
  if (routine && !routine.notify && (message.kind === "completion" || message.kind === "failure"))
    return;
  const everyone = Boolean(routine) && message.kind === "completion";
  await notifyChat(
    deps,
    {
      spaceId: run.spaceId,
      threadId: run.threadId,
      ...(everyone ? {} : { to: [run.userId] }),
      message: {
        ...message,
        kind: message.kind === "completion" ? "message" : message.kind,
        sender: await doodleNotificationIdentity(),
      },
    },
    options,
  );
}

/** Open apps alert from the same message. Not awaited, so it never holds up the push. */
export function publishChatAlert(
  events: Pick<ThreadEvents, "publishChatAlert"> | undefined,
  person: { spaceId: string; userId: string },
  message: NotificationMessage,
) {
  void (async () =>
    events?.publishChatAlert?.(person.userId, {
      kind: message.kind,
      title: truncatePlainText(message.title, COMPLETION_NOTIFICATION_MAX_CHARS),
      body: truncatePlainText(message.body, COMPLETION_NOTIFICATION_MAX_CHARS),
      spaceId: person.spaceId,
      threadId: message.threadId,
    }))().catch((error) => getLogger().error("chat alert publish", error));
}

export function runSendsFinishNotification(trigger: string): boolean {
  return !isBackgroundRunTrigger(trigger);
}

/** User-facing text for completion notifications; empty when only tool/step activity remains. */
export function completionNotificationBody(assembled: string, blocks: MessageBlock[]): string {
  if (assembled) return assembled;
  return blocks
    .filter((block): block is Extract<MessageBlock, { kind: "text" }> => block.kind === "text")
    .map((block) => block.text)
    .join("");
}

/** Push body: Markdown stripped, then truncated so a cut cannot land inside a marker. */
export function completionNotificationPreview(text: string): string {
  return truncatedPlainText(text, COMPLETION_NOTIFICATION_MAX_CHARS);
}

/** A secret card can ask for a code or a login, so the title stays generic and the label short. */
export function secretAskNotification(botName: string, label: string, runSecrets: string[]) {
  // Strip and redact before shortening so no protected value is left half-shown.
  const text = plainTextFromMarkdown(redactSecrets(label, runSecrets), { maxSource: Infinity });
  const body = truncatePlainText(
    redactSecrets(text, runSecrets),
    COMPLETION_NOTIFICATION_MAX_CHARS,
  );
  return { title: `${botName} needs an answer`, body };
}

export function completionMarksUnread(trigger: string, text: string): boolean {
  if (isBackgroundRunTrigger(trigger)) return false;
  return (trigger !== "routine" && trigger !== "reaction") || Boolean(text);
}

export function subagentMarksUnread(trigger: string, status: "running" | "completed" | "failed") {
  if (isBackgroundRunTrigger(trigger)) return false;
  return status === "failed" || trigger !== "routine";
}
