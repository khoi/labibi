import * as SecureStore from "expo-secure-store";
import { captureApiRequestContext, currentApiBase, fetchMobileJson, selectedSpaceId } from "./api";
import { currentSessionGeneration } from "./session";

const LAST_CHAT_KEY = "rakazo.last_chat_id";
const LEGACY_KEYS = ["rakazo.last_bot_id", "rakazo.last_bot_space_id"];
const READ_TIMEOUT_MS = 500;
let writes: Promise<unknown> = Promise.resolve();

function enqueueWrite(task: () => Promise<void>): Promise<void> {
  const next = writes.then(task, task);
  writes = next.catch(() => undefined);
  return next;
}

/** Verify the owner with the bearer we will use, including after a cold start or token rotation. */
async function currentOwner() {
  const context = await captureApiRequestContext(null);
  if (!context.headers.authorization) return null;
  const { response, body, invalidJson } = await fetchMobileJson<{ user?: { id?: string } }>(
    `${context.apiBase}/api/auth/get-session`,
    { headers: { ...context.headers, origin: "rakazo://" } },
    {},
  );
  if (
    !response.ok ||
    invalidJson ||
    typeof body?.user?.id !== "string" ||
    !body.user.id.trim() ||
    context.sessionGeneration !== currentSessionGeneration() ||
    context.apiBase !== currentApiBase()
  )
    return null;
  return { apiBase: context.apiBase, userId: body.user.id };
}

/** The chat, workspace, and owner form one record; a partial or late write cannot change its owner. */
export async function saveLastChatId(threadId: string, spaceId: string | null) {
  if (!threadId.trim()) return;
  const generation = currentSessionGeneration();
  return enqueueWrite(async () => {
    if (generation !== currentSessionGeneration()) return;
    const owner = await currentOwner();
    if (!owner || generation !== currentSessionGeneration()) return;
    await SecureStore.setItemAsync(LAST_CHAT_KEY, JSON.stringify({ ...owner, threadId, spaceId }));
  });
}

/** The record belongs to the workspace it was saved in; another workspace starts without it. */
function inSelectedSpace(record: { spaceId?: unknown }): boolean {
  return typeof record.spaceId !== "string" || record.spaceId === selectedSpaceId();
}

export async function loadLastChatId() {
  const generation = currentSessionGeneration();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      writes.then(async () => {
        const record = JSON.parse((await SecureStore.getItemAsync(LAST_CHAT_KEY)) ?? "null");
        if (
          !record ||
          typeof record.threadId !== "string" ||
          !record.threadId.trim() ||
          record.apiBase !== currentApiBase() ||
          typeof record.userId !== "string" ||
          !record.userId.trim()
        )
          return "";
        if (!inSelectedSpace(record)) return "";
        const owner = await currentOwner();
        // The selection may have moved to another workspace while the owner was verified.
        return owner &&
          generation === currentSessionGeneration() &&
          owner.apiBase === record.apiBase &&
          owner.userId === record.userId &&
          inSelectedSpace(record)
          ? record.threadId
          : "";
      }),
      new Promise<string>((resolve) => {
        timeout = setTimeout(() => resolve(""), READ_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return "";
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

/** Cleanup is optional: ownership checks protect readers even if deleting the record stalls. */
export async function clearLastChat() {
  return enqueueWrite(async () => {
    for (const key of [LAST_CHAT_KEY, ...LEGACY_KEYS])
      await SecureStore.deleteItemAsync(key).catch(() => undefined);
  });
}
