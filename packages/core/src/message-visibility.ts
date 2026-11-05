import type { MessageBlock } from "@labradoodle/contracts";

type PresentableMessage = {
  runId?: string;
  blocks: readonly MessageBlock[];
};

export type UserVisibleMessagesOptions = {
  /**
   * Run ids for background triggers (e.g. `tickets`). Their messages are hidden
   * except cards that need user input.
   */
  backgroundRunIds?: Iterable<string>;
};

/** User-input cards remain visible when their run otherwise stays in the background. */
export function isBackgroundInputBlock(block: unknown): boolean {
  return (
    !!block &&
    typeof block === "object" &&
    "kind" in block &&
    (block.kind === "ask" ||
      block.kind === "computer" ||
      block.kind === "mcp_approval" ||
      block.kind === "app_connect")
  );
}

export function userVisibleMessages<T extends PresentableMessage>(
  messages: readonly T[],
  options: UserVisibleMessagesOptions = {},
): T[] {
  const backgroundRunIds = new Set(options.backgroundRunIds ?? []);
  return messages.filter(
    (message) =>
      !message.runId ||
      !backgroundRunIds.has(message.runId) ||
      message.blocks.some(isBackgroundInputBlock),
  );
}
