import type { RpcInput, RpcPath, SpaceBot, SpaceGroup } from "@labradoodle/contracts";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useState } from "react";
import { Alert } from "react-native";
import type { ApiRequestContext, MobileBot, MobileGroup, RpcArgs } from "./api";
import {
  captureApiRequestContext,
  currentApiBase,
  loadSessionToken,
  rpc,
  selectedSpaceId,
} from "./api";
import { confirmDeleteBot, confirmDeleteGroup } from "./bot-lifecycle";
import { useI18n } from "./i18n";
import type { InboxChatKind, InboxRowAction } from "./inbox-swipe";
import { chatTarget, createLatestQueue, unreadOverrideKey } from "./inbox-swipe";
import { afterChatNotifyChange, dismissThreadNotifications } from "./live-notifications";
import { currentSessionGeneration } from "./session";
import { errorText } from "./user-error";

/** Sends a request about a chat to that chat's space without switching to it. */
async function chatRequestContext(
  spaceId: string | undefined,
): Promise<ApiRequestContext | undefined> {
  if (!spaceId || spaceId === selectedSpaceId()) return undefined;
  const context = await captureApiRequestContext();
  return { ...context, headers: { ...context.headers, "x-rakazo-space-id": spaceId } };
}

export async function chatRpc<P extends RpcPath>(
  spaceId: string | undefined,
  proc: P,
  body: RpcInput<P>,
) {
  const requestContext = await chatRequestContext(spaceId);
  return requestContext
    ? rpc(proc, ...([body, { requestContext, skipSpaceAuthRecovery: true }] as RpcArgs<P>))
    : rpc(proc, ...([body] as RpcArgs<P>));
}

type ListUpdate<T> = Dispatch<SetStateAction<T[]>>;

/** Row actions on inbox chats: read state, finish notifications and delete. */
export function useInboxChatActions({
  loadBots,
  setBots,
  setGroups,
}: {
  loadBots: () => Promise<unknown>;
  setBots: ListUpdate<MobileBot>;
  setGroups: ListUpdate<MobileGroup>;
}) {
  const { t } = useI18n();
  const [unreadOverrides, setUnreadOverrides] = useState<ReadonlyMap<string, boolean>>(
    () => new Map(),
  );
  // One path for the long-press sheet and the swipe actions.
  const [sendReadState] = useState(() => createLatestQueue<boolean>());
  const setNotifyOnFinish = useCallback(
    async (
      kind: InboxChatKind,
      chat: MobileBot | MobileGroup | SpaceBot | SpaceGroup,
      notify: boolean,
    ) => {
      if (kind !== "bot") return;
      await chatRpc(chat.spaceId, "bots/update", { botId: chat.id, notifyOnFinish: notify });
      await afterChatNotifyChange(
        currentApiBase(),
        await loadSessionToken(),
        selectedSpaceId() ?? "",
        { botId: chat.id, threadId: "threadId" in chat ? chat.threadId : undefined, notify },
      );
      await loadBots();
    },
    [loadBots],
  );
  const runRowAction = useCallback(
    async (
      kind: InboxChatKind,
      chat: MobileBot | MobileGroup | SpaceBot | SpaceGroup,
      action: InboxRowAction,
    ) => {
      if (action === "read" || action === "unread") {
        const key = unreadOverrideKey(kind, chat.id);
        // Queued changes belong to the session and the chat's own Space.
        const spaceId = chat.spaceId ?? selectedSpaceId();
        const session = currentSessionGeneration();
        setUnreadOverrides((current) => new Map(current).set(key, action === "unread"));
        if (action === "read") {
          void dismissThreadNotifications(
            kind === "group"
              ? { groupId: chat.id }
              : "threadId" in chat && chat.threadId
                ? { threadId: chat.threadId }
                : { botId: chat.id },
          ).catch(() => undefined);
        }
        await sendReadState(
          key,
          action === "unread",
          async (unread) => {
            const context = await captureApiRequestContext();
            if (context.sessionGeneration !== session) return;
            const headers = { ...context.headers };
            if (spaceId) headers["x-rakazo-space-id"] = spaceId;
            else delete headers["x-rakazo-space-id"];
            await rpc(
              unread ? "threads/markUnread" : "threads/markRead",
              chatTarget(kind, chat.id),
              { requestContext: { ...context, headers } },
            );
            const mark = <T extends { id: string; unread: boolean }>(chats: T[]) =>
              chats.map((item) => (item.id === chat.id ? { ...item, unread } : item));
            if (kind === "bot") setBots(mark);
            else setGroups(mark);
            await loadBots();
          },
          // The override stays until the last queued change for this chat is done.
          () =>
            setUnreadOverrides((current) => {
              const next = new Map(current);
              next.delete(key);
              return next;
            }),
        ).catch((err) => {
          // A change from a session that has since ended is dropped quietly.
          if (session !== currentSessionGeneration()) return;
          Alert.alert(t("Could not update chat"), errorText(err, t("Try again.")));
        });
        return;
      }
      // The same confirmation as the chat's own menu; the row goes once the server deletes it.
      const deleted = () => void loadBots();
      if (kind === "bot") confirmDeleteBot({ id: chat.id, name: chat.name }, deleted);
      else confirmDeleteGroup({ id: chat.id, name: chat.name }, deleted);
    },
    [loadBots, sendReadState, t],
  );
  const botAction = useCallback(
    (action: InboxRowAction, bot: MobileBot | SpaceBot) => void runRowAction("bot", bot, action),
    [runRowAction],
  );
  const groupAction = useCallback(
    (action: InboxRowAction, group: MobileGroup | SpaceGroup) =>
      void runRowAction("group", group, action),
    [runRowAction],
  );
  // The iOS row menu changes the chat in place, so failures use the native alert.
  const notifyFromMenu = useCallback(
    (kind: InboxChatKind, chat: MobileBot | MobileGroup | SpaceBot | SpaceGroup, notify: boolean) =>
      void setNotifyOnFinish(kind, chat, notify).catch((err) =>
        Alert.alert(t("Could not update chat"), errorText(err, t("Try again."))),
      ),
    [t, setNotifyOnFinish],
  );
  return {
    unreadOverrides,
    setNotifyOnFinish,
    runRowAction,
    botAction,
    groupAction,
    notifyFromMenu,
  };
}
