import { useEffect } from "react";
import type { MobileChat } from "./api";
import { setSearchInbox } from "./search-inbox";

/** Shares the inbox's chats with search once a saved or live inbox has supplied the account. */
export function usePublishSearchInbox(chats: readonly MobileChat[], loaded: boolean) {
  useEffect(() => {
    // A remounted session has no roster until its saved or live inbox arrives.
    if (loaded) setSearchInbox(chats);
  }, [chats, loaded]);
}
