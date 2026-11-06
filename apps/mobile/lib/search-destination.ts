import type { SearchHit } from "@labradoodle/contracts";

/**
 * Message id to open, if the hit is a row inside a chat.
 * A conversation hit is the chat itself and opens on the newest message.
 */
export function searchHitMessageId(hit: SearchHit): string | undefined {
  if (hit.kind === "conversation") return undefined;
  return hit.messageId;
}

export function mobileSearchDestination(
  hit: SearchHit,
):
  | { pathname: "/routine"; params: { threadId: string; routineId: string } }
  | { pathname: "/thread"; params: { threadId: string; messageId?: string } } {
  if (hit.routineId) {
    return { pathname: "/routine", params: { threadId: hit.threadId, routineId: hit.routineId } };
  }
  const messageId = searchHitMessageId(hit);
  return {
    pathname: "/thread",
    params: { threadId: hit.threadId, ...(messageId ? { messageId } : {}) },
  };
}
