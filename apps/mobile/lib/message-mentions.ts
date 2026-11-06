import { plainTextLinkParts } from "@labradoodle/chat-ui/native";
import type { MentionTextPart } from "@labradoodle/core";
import { DOODLE_NAME, displayName, splitMentionText } from "@labradoodle/core";
import type { ReactNode } from "react";
import { createContext } from "react";

/** Draws what a reply announces where its text names it. */
export const MessageMentionsContext = createContext<((id: string) => ReactNode) | undefined>(
  undefined,
);

/** Who a sent message's `@Name` can refer to: Doodle, or a person in the chat. */
export type UserMentionTarget =
  | { kind: "doodle"; id: "doodle"; name: string }
  | { kind: "person"; id: string; name: string; image: string | null };

/** Who a sent message's `@Name` can refer to; absent without anyone to name. */
export const UserMentionsContext = createContext<
  { targets: readonly UserMentionTarget[] } | undefined
>(undefined);

/**
 * The targets a sent message can name: Doodle while it is in the chat, and its people. A name two
 * people share stays plain text: the text alone cannot say which one was meant.
 */
export function userMentionTargets(chat: {
  doodle: boolean;
  members: readonly { userId: string; name: string; image: string | null }[];
}): UserMentionTarget[] {
  const named = chat.members.map((member) => ({ member, name: displayName(member.name, "") }));
  const counts = new Map<string, number>();
  for (const { name } of named)
    counts.set(name.toLowerCase(), (counts.get(name.toLowerCase()) ?? 0) + 1);
  const people: UserMentionTarget[] = named
    .filter(({ name }) => name && counts.get(name.toLowerCase()) === 1)
    .map(({ member, name }) => ({ kind: "person", id: member.userId, name, image: member.image }));
  return chat.doodle ? [{ kind: "doodle", id: "doodle", name: DOODLE_NAME }, ...people] : people;
}

/**
 * A sent message cut into plain runs and mentions; a link, email address or page link is never
 * searched for names.
 */
export function textWithMentions(
  text: string,
  targets: readonly UserMentionTarget[],
): MentionTextPart<UserMentionTarget>[] {
  return plainTextLinkParts(text).flatMap((piece) =>
    piece.type === "text" ? splitMentionText(piece.value, targets) : [{ text: piece.value }],
  );
}

/** Opens a page a reply links as `[title](page:<pageId>)`. */
export const OpenPageContext = createContext<((pageId: string) => void) | undefined>(undefined);
