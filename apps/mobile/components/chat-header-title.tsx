import { useRouter } from "expo-router";
import { useSyncExternalStore } from "react";
import { Pressable } from "react-native";
import type { MobileChat } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { useThemedStyles } from "../lib/native";
import { useInboxChat } from "../lib/search-inbox";
import { ChatAvatar } from "./chat-avatar";
import { ChatTitleLabel } from "./chat-title-label";
import { DoodleAvatar } from "./doodle-avatar";
import { GlassSurface } from "./glass-surface";
import { createThreadHeaderStyles } from "./thread-header-styles";

const TITLE_AVATAR_SIZE = 28;

/** What an open chat shows in its title, once it has loaded its own data. */
export type ChatTitle = {
  chat: MobileChat | undefined;
  viewerUserId: string | undefined;
  /** Doodle's activity in the chat. */
  status: string | undefined;
  composing: boolean;
  /** Tapping the title opens the chat's settings, unless the chat is read-only. */
  opens: boolean;
};

/** The route params a chat screen opens with. */
export type ChatTitleParams = { threadId?: string; readOnly?: string };

// The open chat screens' titles, by screen (route key): two screens of the same chat, as during
// a push, a pop or a cancelled swipe back, each keep their own. A chat publishes its title here
// instead of replacing its header title, so the native title view is set once, when the screen
// is created.
const titles = new Map<string, ChatTitle>();
const listeners = new Set<() => void>();

/** Publishes a chat screen's title; returns the call that withdraws it when the screen goes. */
export function publishChatTitle(routeKey: string, title: ChatTitle): () => void {
  titles.set(routeKey, title);
  for (const listener of listeners) listener();
  return () => {
    if (titles.get(routeKey) !== title) return;
    titles.delete(routeKey);
    for (const listener of listeners) listener();
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * A chat's title capsule: the people in it (or Doodle in a chat with only you) and its name,
 * opening the chat's settings. The chat route renders it from the screen's first native header,
 * from the inbox's copy of the chat, until the open chat publishes its own data.
 */
export function ChatHeaderTitle({
  routeKey,
  params,
}: {
  routeKey: string;
  params: ChatTitleParams;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const styles = useThemedStyles(createThreadHeaderStyles);
  const published = useSyncExternalStore(subscribe, () => titles.get(routeKey));
  const inboxChat = useInboxChat(params.threadId);
  const chat = published?.chat ?? inboxChat;
  const opens = published?.opens ?? params.readOnly !== "1";
  const label = chat ? chat.title || t("New chat") : t("Chat");
  const viewerUserId = published?.viewerUserId;
  const solo = chat ? chat.members.every((member) => member.userId === viewerUserId) : true;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={opens ? t("Chat settings") : label}
      disabled={!opens || !params.threadId}
      onPress={() => {
        if (opens && params.threadId)
          router.push({ pathname: "/chat-settings", params: { threadId: params.threadId } });
      }}
    >
      <GlassSurface style={styles.titleCapsule} fallbackStyle={styles.titleCapsuleFill}>
        {chat && solo && chat.doodle ? (
          <DoodleAvatar
            identity={chat.id}
            size={TITLE_AVATAR_SIZE}
            status={published?.status ?? chat.status}
            composing={published?.composing ?? false}
            muted={chat.muted}
          />
        ) : chat ? (
          <ChatAvatar chat={chat} viewerUserId={viewerUserId} size={TITLE_AVATAR_SIZE} />
        ) : null}
        <ChatTitleLabel label={label} placeholder={!chat} style={styles.title} />
      </GlassSurface>
    </Pressable>
  );
}
