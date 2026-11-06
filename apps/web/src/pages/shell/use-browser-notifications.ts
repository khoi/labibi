import type { ChatAlert } from "@labradoodle/contracts";
import { isRetryableError, retryDelayMs } from "@labradoodle/core";
import type { RefObject } from "react";
import { useEffect, useRef } from "react";
import { notificationIcon, prepareNotificationIcon } from "../../lib/notification-icon";
import type { RpcClient } from "../../lib/rpc";

/**
 * The server's alerts for the person's chats in this workspace, shown as browser notifications,
 * and the signal that the workspace's Doodle settings changed.
 */
export function useBrowserNotifications({
  rpc,
  activeThreadId,
  openChat,
  onDoodleChanged,
}: {
  rpc: Pick<RpcClient, "notifications">;
  activeThreadId: RefObject<string | undefined>;
  openChat: (alert: ChatAlert) => void;
  onDoodleChanged: () => void;
}) {
  const openChatRef = useRef(openChat);
  openChatRef.current = openChat;
  const onDoodleChangedRef = useRef(onDoodleChanged);
  onDoodleChangedRef.current = onDoodleChanged;
  useEffect(() => {
    prepareNotificationIcon();
    let active = true;
    let controller: AbortController | undefined;
    let cancelRetry: (() => void) | undefined;
    // A click must not reach a shell that has gone, so its alerts go with it.
    const shown = new Set<Notification>();
    const show = (alert: ChatAlert) => {
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      const watching =
        alert.threadId === activeThreadId.current &&
        document.visibilityState === "visible" &&
        document.hasFocus();
      if (watching) return;
      try {
        const icon = notificationIcon();
        const notification = new Notification(alert.title, {
          body: alert.body,
          ...(icon ? { icon } : {}),
          // Per chat and kind: a repeat replaces its copy, but a question after a reply still pops up.
          tag: `${alert.threadId}:${alert.kind}`,
        });
        shown.add(notification);
        notification.onclose = () => shown.delete(notification);
        notification.onclick = () => {
          window.focus();
          openChatRef.current(alert);
          notification.close();
        };
      } catch {
        // Some browsers only allow notifications from a service worker.
      }
    };
    void (async () => {
      while (active) {
        controller = new AbortController();
        let failure: unknown;
        try {
          const stream = await rpc.notifications.subscribe(undefined, {
            signal: controller.signal,
          });
          for await (const frame of stream) {
            if (!active) return;
            if (frame.type === "doodle") onDoodleChangedRef.current();
            if (frame.alert) show(frame.alert);
          }
        } catch (cause) {
          failure = cause;
        } finally {
          controller.abort();
        }
        if (!active || (failure !== undefined && !isRetryableError(failure))) return;
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, retryDelayMs(failure, 1_000));
          cancelRetry = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        cancelRetry = undefined;
      }
    })();
    return () => {
      active = false;
      controller?.abort();
      cancelRetry?.();
      for (const notification of shown) notification.close();
    };
  }, [rpc]);
}
