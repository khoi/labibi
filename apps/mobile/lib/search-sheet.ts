import type { SearchHit } from "@labradoodle/contracts";
import { dedupeSearchHits, searchHitListKey } from "@labradoodle/core";
import type { MobileChat } from "./api";
import { t } from "./i18n";
import { previewSnippet } from "./preview";
import { mobileSearchDestination } from "./search-destination";
import { searchHitRowPreview } from "./search-list";

export type SearchSheetRow = {
  key: string;
  title: string;
  preview: string;
  label: string;
  chat?: MobileChat;
  kind: SearchHit["kind"];
  destination: ReturnType<typeof mobileSearchDestination>;
};

export function searchKindLabel(hit: SearchHit): string {
  switch (hit.kind) {
    case "conversation":
      return t("Chat");
    case "message":
      return t("Message");
    case "file":
      return t("File");
    case "link":
      return t("Link");
    case "routine":
      return t("Routine");
  }
}

/** The chats whose title or last message matches, then what the server found inside chats. */
export function searchSheetRows(
  chats: readonly MobileChat[],
  query: string,
  hits: readonly SearchHit[],
): SearchSheetRow[] {
  const needle = query.trim().toLowerCase();
  const rows: SearchSheetRow[] = chats
    .filter((chat) => `${chat.title} ${chat.preview}`.toLowerCase().includes(needle))
    .map((chat) => ({
      key: `chat-${chat.id}`,
      title: chat.title || t("New chat"),
      preview: previewSnippet(chat.preview, 40),
      label: t("Chat"),
      chat,
      kind: "conversation",
      destination: { pathname: "/thread", params: { threadId: chat.id } },
    }));
  if (!needle) return rows;
  const listed = new Set(rows.map((row) => row.key));
  for (const hit of dedupeSearchHits(hits)) {
    if (hit.kind === "conversation" && listed.has(`chat-${hit.threadId}`)) continue;
    rows.push({
      key: searchHitListKey(hit),
      title: hit.title,
      preview: searchHitRowPreview(hit),
      label: searchKindLabel(hit),
      chat: chats.find((chat) => chat.id === hit.threadId),
      kind: hit.kind,
      destination: mobileSearchDestination(hit),
    });
  }
  return rows;
}
