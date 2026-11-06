import { useSyncExternalStore } from "react";
import type { MobileChat } from "./api";
import { currentApiBase } from "./api";
import { currentSessionGeneration, subscribeSessionGeneration } from "./session";

const empty: readonly MobileChat[] = [];
let snapshot = empty;
let generation = -1;
let apiBase = "";
const listeners = new Set<() => void>();
const changeListeners = new Set<(chat: MobileChat) => void>();
// Chats added before the inbox lists them (one just created). They outlast the inbox's refreshes
// so an open chat's title keeps them.
let additions: MobileChat[] = [];

function publish(next: readonly MobileChat[]) {
  snapshot = next;
  for (const listener of listeners) listener();
}

/** Shares the inbox's chats with search and the chat screen without another request. */
export function setSearchInbox(chats: readonly MobileChat[]): void {
  const sameSession = generation === currentSessionGeneration() && apiBase === currentApiBase();
  generation = currentSessionGeneration();
  apiBase = currentApiBase();
  const listed = new Set(chats.map((chat) => chat.id));
  additions = sameSession ? additions.filter((chat) => !listed.has(chat.id)) : [];
  publish([...additions, ...chats]);
}

export function getSearchInbox(): readonly MobileChat[] {
  return generation === currentSessionGeneration() && apiBase === currentApiBase()
    ? snapshot
    : empty;
}

export function subscribeSearchInbox(listener: () => void): () => void {
  listeners.add(listener);
  const unsubscribe = subscribeSessionGeneration(listener);
  return () => {
    listeners.delete(listener);
    unsubscribe();
  };
}

/**
 * Puts a chat this device just created or changed first, so the inbox and the screen it opens
 * draw it at once.
 */
export function addToSearchInbox(chat: MobileChat): void {
  if (generation !== currentSessionGeneration() || apiBase !== currentApiBase()) return;
  additions = [chat, ...additions.filter((kept) => kept.id !== chat.id)];
  publish([chat, ...snapshot.filter((kept) => kept.id !== chat.id)]);
  for (const listener of changeListeners) listener(chat);
}

export function subscribeChatChanges(listener: (chat: MobileChat) => void): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

/** Takes a chat the person left or deleted out of the roster before the inbox reloads. */
export function removeFromSearchInbox(threadId: string): void {
  additions = additions.filter((chat) => chat.id !== threadId);
  if (snapshot.some((chat) => chat.id === threadId))
    publish(snapshot.filter((chat) => chat.id !== threadId));
}

/** A chat as the inbox last loaded it, for a chat screen that opens before its snapshot. */
export function useInboxChat(threadId: string | undefined): MobileChat | undefined {
  const chats = useSyncExternalStore(subscribeSearchInbox, getSearchInbox, getSearchInbox);
  return threadId ? chats.find((chat) => chat.id === threadId) : undefined;
}
