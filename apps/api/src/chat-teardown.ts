import { createAdapterContext, runContinueJob } from "@labradoodle/adapter-kit";
import { forgetPageShareSecrets, stopCancelledRuns } from "@labradoodle/adapters";
import type { Actor } from "@labradoodle/contracts";
import type { ChatTeardown } from "@labradoodle/db";
import { getLogger } from "@labradoodle/logging";
import type { RouterDeps } from "./router.js";

/**
 * After a chat change commits: stop the work it cancelled, start the requests that waited behind
 * it, remove the files and page links of a chat it deleted, and wake the chat's subscribers when
 * it is still there.
 */
export async function finishChatTeardown(
  deps: Pick<RouterDeps, "prisma" | "jobs" | "sandbox" | "artifacts" | "secrets" | "events">,
  actor: Pick<Actor, "spaceId" | "userId">,
  teardown: ChatTeardown,
  threadId: string | null,
): Promise<void> {
  await stopCancelledRuns(deps, actor, teardown).catch((error) => {
    getLogger().error("chat run teardown", error);
  });
  await Promise.all(
    teardown.continuationRunIds.map((runId) =>
      deps.jobs.enqueue(runContinueJob(runId)).catch((error) => {
        getLogger().error("steering continuation enqueue", error);
      }),
    ),
  );
  const removed = await Promise.allSettled(
    teardown.artifactStorageKeys.map((storageKey) =>
      deps.artifacts.remove(
        storageKey,
        createAdapterContext(actor, threadId ?? "chat", `chat-teardown:${storageKey}`),
      ),
    ),
  );
  for (const result of removed) {
    if (result.status === "rejected") getLogger().error("chat file cleanup", result.reason);
  }
  await forgetPageShareSecrets(deps.secrets, teardown.pageShareSecrets).catch((error) => {
    getLogger().error("chat page link cleanup", error);
  });
  if (threadId && teardown.seq !== null) {
    await deps.events.notify(threadId, teardown.seq).catch(() => undefined);
  }
}
