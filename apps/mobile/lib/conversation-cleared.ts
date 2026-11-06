const listeners = new Set<(threadId: string) => void>();

/** Runs when a chat's history is cleared, wherever it was cleared from. */
export function onConversationCleared(listener: (threadId: string) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyConversationCleared(threadId: string) {
  for (const listener of listeners) listener(threadId);
}
