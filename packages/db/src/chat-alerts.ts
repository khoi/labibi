import type { RealtimeFanout } from "@labradoodle/adapter-kit";
import type { ChatAlert } from "@labradoodle/contracts";
import { ChatAlertSchema } from "@labradoodle/contracts";

/** An alert, or word that the workspace's Doodle settings changed and should be read again. */
export type ChatAlertSignal = { type: "alert"; alert: ChatAlert } | { type: "doodle" };

/** Transient: an alert published while the user has no app open is not replayed. */
export interface ChatAlerts {
  publish(userId: string, alert: ChatAlert): Promise<void>;
  publishDoodleChanged(userId: string, spaceId: string): Promise<void>;
  /** Only signals for `spaceId`, so other spaces never crowd them out of the queue. */
  follow(userId: string, spaceId: string, signal?: AbortSignal): AsyncGenerator<ChatAlertSignal>;
}

/** A stream that stops reading keeps only the newest alerts. */
const MAX_QUEUED_ALERTS = 20;

export function chatAlertTopic(userId: string): string {
  return `chat-alerts:${userId}`;
}

/**
 * Without a realtime fanout nothing is published and the stream stays open and empty. A failed
 * subscribe ends the stream with that error, so the app reconnects.
 */
export function createChatAlerts(realtime?: RealtimeFanout): ChatAlerts {
  return {
    async publish(userId, alert) {
      await realtime?.publish(chatAlertTopic(userId), JSON.stringify(alert));
    },
    async publishDoodleChanged(userId, spaceId) {
      await realtime?.publish(chatAlertTopic(userId), JSON.stringify({ doodleChanged: spaceId }));
    },
    async *follow(userId, spaceId, signal) {
      const queue: ChatAlertSignal[] = [];
      let wake: (() => void) | undefined;
      const unsubscribe = realtime
        ? await realtime.subscribe(chatAlertTopic(userId), (payload) => {
            let parsed: unknown;
            try {
              parsed = JSON.parse(payload);
            } catch {
              return;
            }
            const doodle =
              typeof parsed === "object" &&
              parsed !== null &&
              (parsed as { doodleChanged?: unknown }).doodleChanged === spaceId;
            const alert = ChatAlertSchema.safeParse(parsed);
            if (!doodle && (!alert.success || alert.data.spaceId !== spaceId)) return;
            const next: ChatAlertSignal =
              doodle || !alert.success ? { type: "doodle" } : { type: "alert", alert: alert.data };
            if (queue.push(next) > MAX_QUEUED_ALERTS) queue.shift();
            wake?.();
          })
        : async () => {};
      try {
        while (!signal?.aborted) {
          const next = queue.shift();
          if (next) {
            yield next;
            continue;
          }
          await new Promise<void>((resolve) => {
            const done = () => {
              wake = undefined;
              signal?.removeEventListener("abort", done);
              resolve();
            };
            wake = done;
            signal?.addEventListener("abort", done, { once: true });
            if (signal?.aborted) done();
          });
        }
      } finally {
        wake = undefined;
        await unsubscribe();
      }
    },
  };
}
