import { displayIdentityResult, identitySource } from "@labradoodle/core";
import { Directory, File, Paths } from "expo-file-system";
import type { MobileChat, MobileMe, MobileSnapshot, MobileWorkspace } from "./api";
import { currentApiBase, selectedSpaceId } from "./api";
import { artifactCacheSession } from "./artifact-cache-session";
import { onConversationCleared } from "./conversation-cleared";
import { identityLabels } from "./identity-display";
import type { IntegrationsCacheScope } from "./integrations-cache";
import { integrationsCacheScope, isIntegrationsScopeCurrent } from "./integrations-cache";
import {
  currentSessionGeneration,
  loadSessionToken,
  loadVerifiedIntegrationsScope,
  saveVerifiedIntegrationsScope,
} from "./session";

export type SavedChatsScope = IntegrationsCacheScope & { namespace: string };

export type SavedInbox = {
  chats: MobileChat[];
  workspaces: MobileWorkspace[];
  me: Pick<MobileMe, "userId" | "spaceId" | "name">;
};

export const SAVED_CHAT_MESSAGES = 100;
export const SAVED_CHATS = 40;
export const SAVED_INBOXES = 10;
const LEGACY_ROOTS = ["saved-chats-v1", "saved-chats-v2"];
const ROOT = "saved-chats-v3";
export const SAVED_CHAT_MAX_BYTES = 1024 * 1024;
export const SAVED_CHATS_MAX_BYTES = 20 * 1024 * 1024;
const SAVED_INBOX_ROWS = 200;

function spaceFile(scope: SavedChatsScope, name: string): File {
  clearLegacySavedChats();
  const root = new Directory(
    Paths.cache,
    ROOT,
    scope.namespace,
    encodeURIComponent(scope.apiBase),
    `user-${encodeURIComponent(scope.userId)}`,
    `space-${encodeURIComponent(scope.spaceId)}`,
  );
  if (!root.exists) root.create({ intermediates: true, idempotent: true });
  return new File(root, `${encodeURIComponent(name)}.json`);
}

function scopeKey(scope: SavedChatsScope, name: string): string {
  return JSON.stringify([scope.namespace, scope.apiBase, scope.userId, scope.spaceId, name]);
}

function readJson(file: File, key: string): Record<string, unknown> | null {
  if (!file.exists || file.size > SAVED_CHAT_MAX_BYTES) return null;
  const data = JSON.parse(file.textSync());
  return data && typeof data === "object" && data.key === key ? data : null;
}

function isRows(value: unknown): value is Array<{ id: string }> {
  return (
    Array.isArray(value) &&
    value.every((row) => row && typeof row === "object" && typeof row.id === "string")
  );
}

export function readSavedInbox(scope: SavedChatsScope): SavedInbox | null {
  if (!isIntegrationsScopeCurrent(scope)) return null;
  try {
    const data = readJson(spaceFile(scope, "inbox"), scopeKey(scope, "inbox"));
    const inbox = data?.inbox as SavedInbox | undefined;
    const me = inbox?.me;
    if (
      !inbox ||
      !isRows(inbox.chats) ||
      !isRows(inbox.workspaces) ||
      me?.userId !== scope.userId ||
      typeof me.spaceId !== "string" ||
      typeof me.name !== "string"
    )
      return null;
    return displayIdentityResult(["bootstrap"], inbox, identityLabels()) as SavedInbox;
  } catch {
    return null;
  }
}

export function writeSavedInbox(
  scope: SavedChatsScope,
  loaded: Omit<SavedInbox, "me">,
  me: MobileMe,
): void {
  try {
    const inbox: SavedInbox = {
      chats: identitySource(loaded.chats).slice(0, SAVED_INBOX_ROWS),
      workspaces: loaded.workspaces.slice(0, 40),
      me: { userId: me.userId, spaceId: me.spaceId, name: me.name },
    };
    if (!isIntegrationsScopeCurrent(scope) || me.userId !== scope.userId) return;
    writeSavedFile(scope, "inbox", { key: scopeKey(scope, "inbox"), inbox });
  } catch {}
}

export async function savedChatsScope(): Promise<SavedChatsScope | null> {
  clearLegacySavedChats();
  const generation = currentSessionGeneration();
  const apiBase = currentApiBase();
  const selectionId = selectedSpaceId();
  const verified = await loadVerifiedIntegrationsScope();
  const spaceId = selectionId ?? (verified?.selectionId === null ? verified.spaceId : null);
  if (!verified || verified.apiBase !== apiBase || !spaceId) return null;
  return withSessionNamespace({
    apiBase,
    userId: verified.userId,
    spaceId,
    sessionGeneration: generation,
    selectionId,
  });
}

async function withSessionNamespace(
  scope: IntegrationsCacheScope,
): Promise<SavedChatsScope | null> {
  try {
    const namespace = await artifactCacheSession(await loadSessionToken());
    return isIntegrationsScopeCurrent(scope) ? { ...scope, namespace } : null;
  } catch {
    return null;
  }
}

export async function liveSavedChatsScope(): Promise<SavedChatsScope | null> {
  const saved = await savedChatsScope();
  if (saved) return saved;
  const verified = await integrationsCacheScope().catch(() => null);
  return verified ? withSessionNamespace(verified) : null;
}

export async function loadSavedInbox(): Promise<SavedInbox | null> {
  const scope = await savedChatsScope();
  return scope ? readSavedInbox(scope) : null;
}

export function saveInbox(
  verifiedLoad: IntegrationsCacheScope,
  loaded: Omit<SavedInbox, "me">,
  me: MobileMe,
): void {
  if (!isIntegrationsScopeCurrent(verifiedLoad) || verifiedLoad.userId !== me.userId) return;
  const { sessionGeneration, ...verified } = verifiedLoad;
  void saveVerifiedIntegrationsScope(sessionGeneration, verified);
  void withSessionNamespace(verifiedLoad).then((scope) => {
    if (scope) writeSavedInbox(scope, loaded, me);
  });
}

export function savedThreadSnapshot(snapshot: MobileSnapshot): MobileSnapshot {
  snapshot = identitySource(snapshot);
  const { cursor: _cursor, activeRuns: _activeRuns, computer: _computer, ...rest } = snapshot;
  return {
    ...rest,
    messages: snapshot.messages.slice(-SAVED_CHAT_MESSAGES).map((message) => ({
      ...message,
      blocks: message.blocks.map((block) => {
        if (block.kind !== "ask" || block.input !== "secret") return block;
        // Offline cards cannot submit credentials. Keep their visible prompt and status,
        // but never persist hidden credential configuration or protected answers.
        const { credential: _credential, answer: _answer, detail: _detail, ...saved } = block;
        return saved;
      }),
    })),
    olderCursor: null,
    run: null,
  };
}

export function readSavedThread(scope: SavedChatsScope, threadId: string): MobileSnapshot | null {
  if (!isIntegrationsScopeCurrent(scope)) return null;
  try {
    const data = readJson(spaceFile(scope, threadId), scopeKey(scope, threadId));
    const snapshot = data?.snapshot as MobileSnapshot | undefined;
    if (
      !snapshot ||
      snapshot.threadId !== threadId ||
      typeof snapshot.chat !== "object" ||
      !isRows(snapshot.messages) ||
      !snapshot.messages.every(
        (message) => typeof message.role === "string" && Array.isArray(message.blocks),
      )
    )
      return null;
    return displayIdentityResult(
      ["threads", "get"],
      savedThreadSnapshot(snapshot),
      identityLabels(),
    ) as MobileSnapshot;
  } catch {
    return null;
  }
}

function writeSavedFile(
  scope: SavedChatsScope,
  target: string,
  data: Record<string, unknown>,
): void {
  if (!isIntegrationsScopeCurrent(scope)) return;
  const text = JSON.stringify(data);
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > SAVED_CHAT_MAX_BYTES) return;
  const file = spaceFile(scope, target);
  const files: File[] = [];
  const collect = (directory: Directory) => {
    for (const entry of directory.list()) {
      if (entry instanceof File) {
        if (entry.uri !== file.uri) files.push(entry);
      } else collect(entry);
    }
  };
  collect(new Directory(Paths.cache, ROOT));
  let total = bytes + files.reduce((sum, entry) => sum + entry.size, 0);
  files.sort((a, b) => (a.lastModified ?? 0) - (b.lastModified ?? 0));
  const inboxes = files.filter((entry) => entry.name === "inbox.json");
  const threads = files.filter((entry) => entry.name !== "inbox.json");
  const evict = (entries: File[]) => {
    const oldest = entries.shift();
    if (!oldest) throw new Error("Saved cache budget unavailable");
    const size = oldest.size;
    oldest.delete();
    total -= size;
  };
  if (target === "inbox") {
    while (inboxes.length >= SAVED_INBOXES) evict(inboxes);
  } else {
    while (threads.length >= SAVED_CHATS) evict(threads);
  }

  while (total > SAVED_CHATS_MAX_BYTES) evict(threads);
  file.create({ overwrite: true });
  file.write(text);
}

export function writeSavedThread(
  scope: SavedChatsScope,
  threadId: string,
  snapshot: MobileSnapshot,
): void {
  if (!isIntegrationsScopeCurrent(scope) || snapshot.threadId !== threadId) return;
  try {
    writeSavedFile(scope, threadId, {
      key: scopeKey(scope, threadId),
      snapshot: savedThreadSnapshot(snapshot),
    });
  } catch {}
}

// A cleared chat never reopens showing its old messages, even when it was not open.
onConversationCleared((threadId) => forgetSavedThread(threadId));

/**
 * Drops one chat's saved copy in every workspace and account: chat ids are unique, and the
 * workspace selected when the clear finishes need not be the one it was cleared in.
 */
export function forgetSavedThread(threadId: string) {
  const name = `${encodeURIComponent(threadId)}.json`;
  const remove = (directory: Directory) => {
    for (const entry of directory.list()) {
      if (entry instanceof File) {
        if (entry.name === name) entry.delete();
      } else remove(entry);
    }
  };
  try {
    const root = new Directory(Paths.cache, ROOT);
    if (root.exists) remove(root);
  } catch {}
}

export function clearSavedChats(): void {
  clearLegacySavedChats();
  try {
    const root = new Directory(Paths.cache, ROOT);
    if (root.exists) root.delete();
  } catch {}
}

function clearLegacySavedChats(): void {
  for (const legacy of LEGACY_ROOTS) {
    try {
      const root = new Directory(Paths.cache, legacy);
      if (root.exists) root.delete();
    } catch {}
  }
}
