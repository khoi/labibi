import { useCallback, useEffect, useState } from "react";
import type { MobileChat } from "./api";
import { rpc } from "./api";
import { addToSearchInbox } from "./search-inbox";
import { errorText } from "./user-error";

/** One chat's people and settings, read from its snapshot; a change hands back the new chat. */
export function useChat(threadId: string | undefined) {
  const [chat, setChat] = useState<MobileChat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!threadId) return;
    try {
      const snapshot = await rpc("threads/get", { threadId });
      setChat(snapshot.chat);
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }, [threadId]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const changed = useCallback((next: MobileChat) => {
    setChat(next);
    // The inbox and the chat's own title draw the change before their next refresh.
    addToSearchInbox(next);
  }, []);
  return { chat, error, setError, reload, changed };
}
