import type {
  AgentHomeStore,
  ArtifactStore,
  JobPublisher,
  SandboxProvider,
  SecretStore,
} from "@labradoodle/adapter-kit";
import { createAdapterContext, runContinueJob } from "@labradoodle/adapter-kit";
import {
  expireComputerControl,
  forgetPageShareSecrets,
  removeAgentHome,
  stopCancelledRuns,
  toComputerRef,
} from "@labradoodle/adapters";
import type { PrismaClient, SpaceDeparture, ThreadEvents } from "@labradoodle/db";
import { getLogger } from "@labradoodle/logging";

/**
 * After someone leaves a workspace, is removed, or deletes their account: tell clients their runs
 * were cancelled, stop those runs' work, release the screens they held, start the follow-ups that
 * waited behind them, destroy their computer there, and remove the files and page links of the
 * chats that went with them. The departure is committed, so each failure is logged rather than
 * reported; expired leases and the job reconciler catch up.
 */
export async function afterSpaceDeparture(
  deps: {
    prisma: PrismaClient;
    sandbox: SandboxProvider;
    jobs: JobPublisher;
    events: ThreadEvents;
    home: AgentHomeStore;
    artifacts: ArtifactStore;
    secrets?: Pick<SecretStore, "delete">;
    dataDir: string;
  },
  actor: { spaceId: string; userId: string },
  departure: SpaceDeparture,
): Promise<void> {
  await Promise.all(
    departure.events.map(({ threadId, seq }) =>
      deps.events.notify(threadId, seq).catch((error) => {
        getLogger().error("space departure realtime notification", error);
      }),
    ),
  );
  await stopCancelledRuns(deps, actor, departure).catch((error) => {
    getLogger().error("space departure run teardown", error);
  });
  await Promise.all(
    departure.heldControls.map(({ computerId, leaseId }) =>
      expireComputerControl(deps, computerId, leaseId).catch((error) => {
        getLogger().error("space departure control release", error);
      }),
    ),
  );
  await Promise.all(
    departure.continuationRunIds.map((runId) =>
      deps.jobs.enqueue(runContinueJob(runId)).catch((error) => {
        getLogger().error("steering continuation enqueue", error);
      }),
    ),
  );
  const context = createAdapterContext(actor, "departure", `space-departure:${actor.spaceId}`);
  await Promise.all(
    departure.ownComputers.map(async (computer) => {
      try {
        if (computer.providerRef) await deps.sandbox.destroy(toComputerRef(computer), context);
        await deps.prisma.computer.deleteMany({ where: { id: computer.id } });
        await removeAgentHome(deps.home, computer.homeKey, deps.dataDir);
      } catch (error) {
        // The row stays for a later departure or space deletion to retry.
        getLogger().error("space departure computer teardown", error);
      }
    }),
  );
  const removed = await Promise.allSettled(
    departure.artifactStorageKeys.map((storageKey) => deps.artifacts.remove(storageKey, context)),
  );
  for (const result of removed) {
    if (result.status === "rejected") getLogger().error("space departure file", result.reason);
  }
  if (deps.secrets) {
    await forgetPageShareSecrets(deps.secrets, departure.pageShareSecrets).catch((error) => {
      getLogger().error("space departure page links", error);
    });
  }
}
