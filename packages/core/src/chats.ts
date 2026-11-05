import type { ChatMentionTarget } from "@labradoodle/contracts";
import { displayName } from "./display-name.js";
import { plainTextFromMarkdown } from "./markdown-plain.js";

/** Who wrote a chat message. */
export type ChatAuthor = { kind: "doodle" } | { kind: "person"; userId: string };

/** Something a person did in a chat that Doodle might answer. */
export type DoodleTurn = {
  /** Doodle is on in this chat. */
  doodle: boolean;
  /** People in the chat, the sender included. */
  people: number;
  senderUserId: string;
} & (
  | {
      kind: "message";
      mentions: readonly Pick<ChatMentionTarget, "kind">[];
      /** Author of the message this one replies to. */
      replyTo?: ChatAuthor;
      /** The person Doodle's open question in this chat is waiting on. */
      openQuestionFor?: string;
    }
  | { kind: "reaction"; target: ChatAuthor }
);

/**
 * Whether Doodle runs for this turn. Off, never. With one person, every message. With several,
 * only when the message is addressed to Doodle: a mention, a reply to it, or the answer to its
 * question from the person it asked. A reaction counts only on Doodle's own message.
 */
export function doodleReplies(turn: DoodleTurn): boolean {
  if (!turn.doodle) return false;
  if (turn.kind === "reaction") return turn.target.kind === "doodle";
  if (turn.people <= 1) return true;
  return (
    turn.mentions.some((mention) => mention.kind === "doodle") ||
    turn.replyTo?.kind === "doodle" ||
    turn.openQuestionFor === turn.senderUserId
  );
}

export const CHAT_TITLE_MAX_LENGTH = 80;

/**
 * What one person sees a chat called: its name; else the other people in it; else, in a chat
 * with only them, its first message. Empty when there is none yet, for the client's own label.
 */
export function chatTitle(
  chat: {
    name: string | null;
    people: readonly { userId: string; name: string }[];
    firstMessage?: string | null;
  },
  viewerUserId: string,
): string {
  const name = chat.name?.trim();
  if (name) return name;
  const others = chat.people
    .filter((person) => person.userId !== viewerUserId)
    .map((person) => displayName(person.name, ""))
    .filter(Boolean);
  if (others.length) return others.join(", ");
  const line = plainTextFromMarkdown(chat.firstMessage ?? "");
  return [...line].slice(0, CHAT_TITLE_MAX_LENGTH).join("").trim();
}
