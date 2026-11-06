import type { AdapterContext } from "@labradoodle/adapter-kit";
import { forgetPageShareSecrets, removeAgentHome, toComputerRef } from "@labradoodle/adapters";
import type { Prisma, ThreadEvents } from "@labradoodle/db";
import {
  claimSpacesLeavingWithAccount,
  deleteClaimedSpace,
  deletePageShareSecrets,
  prepareAccountDeletion,
  recordComputerRunEnd,
  restoreSpaceDeletionClaims,
} from "@labradoodle/db";
import { getLogger } from "@labradoodle/logging";
import type { BillingService } from "./billing.js";
import type { SpaceDeletionDeps } from "./space-deletion.js";
import { afterSpaceDeparture } from "./space-departure.js";

/**
 * Each sandbox is destroyed at its provider before its row goes, so a failure keeps the handle
 * and deleting again resumes from what is left.
 */
export async function deleteAccountContent(
  deps: SpaceDeletionDeps & {
    events: ThreadEvents;
    billing?: Pick<BillingService, "cancelForDeletedUser">;
  },
  userId: string,
): Promise<void> {
  const { claimId, spaceIds, takenOver } = await claimSpacesLeavingWithAccount(deps.prisma, userId);
  try {
    // Cancel under the claims, so a checkout opened while another organization's cancellation
    // waits is refused by the deletion check instead of outliving the account.
    await deps.billing?.cancelForDeletedUser(userId);
  } catch (error) {
    // Nothing was destroyed yet, so the account stays as it was: give back only what this
    // attempt claimed, keeping claims an earlier attempt left and other deletions' markers.
    await restoreSpaceDeletionClaims(deps.prisma, claimId, takenOver);
    throw error;
  }
  // Then leave other people's workspaces, so the chats there stay with the people still in them.
  // None of them is claimed above: each keeps another full member. As after leaving: tell
  // members, stop the cancelled runs' work, free held screens, start others' waiting
  // follow-ups, and destroy the account's computer there.
  const departures = await prepareAccountDeletion(deps.prisma, userId);
  for (const departure of departures) {
    await afterSpaceDeparture(deps, { spaceId: departure.spaceId, userId }, departure);
  }
  const leaving = { OR: [{ userId }, { spaceId: { in: spaceIds } }] };
  await deleteClaimedSpaces(deps, {
    userId,
    operationId: `account-delete:${userId}`,
    claimId,
    spaceIds,
    soleMemberId: userId,
    computers: leaving,
  });

  // Pages in Spaces that stay go with the user row; their links' tokens leave the store now.
  const memberPageSecrets = await deps.prisma.$transaction((tx) =>
    deletePageShareSecrets(tx, { userId, spaceId: { notIn: spaceIds } }),
  );
  if (deps.secrets) await forgetPageShareSecrets(deps.secrets, memberPageSecrets);
}

/** Tears down the computers matched, then deletes the claimed workspaces and their files. */
async function deleteClaimedSpaces(
  deps: SpaceDeletionDeps,
  input: {
    userId: string;
    operationId: string;
    claimId: string;
    spaceIds: string[];
    soleMemberId?: string;
    /** Deletes the organization with its last Space. */
    organizationId?: string;
    computers: Prisma.ComputerWhereInput;
    signal?: AbortSignal;
  },
): Promise<void> {
  const context = (spaceId: string, botId?: string) =>
    adapterContext(input.operationId, input.userId, spaceId, botId, input.signal);
  const computers = await deps.prisma.computer.findMany({
    where: input.computers,
    select: {
      id: true,
      spaceId: true,
      homeKey: true,
      kind: true,
      providerRef: true,
    },
  });
  input.signal?.throwIfAborted();
  await settleAll(
    computers.map(async (computer) => {
      if (computer.providerRef) {
        await deps.sandbox.destroy(toComputerRef(computer), context(computer.spaceId));
        await recordComputerRunEnd(deps.prisma, computer, "deleted");
      }
      await removeAgentHome(deps.home, computer.homeKey, deps.dataDir);
      // The row holds the stored home's key, so the stored copy is unreadable from here on.
      await deps.prisma.computer.deleteMany({
        where: { id: computer.id, providerRef: computer.providerRef },
      });
    }),
  );

  for (const spaceId of input.spaceIds) {
    // Teardown abandoned at a deadline that finishes later leaves the rest to the next attempt.
    input.signal?.throwIfAborted();
    const deleted = await deleteClaimedSpace(deps.prisma, {
      spaceId,
      claimId: input.claimId,
      soleMemberId: input.soleMemberId,
      organizationId: input.organizationId,
    });
    if (!deleted) continue;
    const cleanup = await Promise.allSettled(
      deleted.artifactKeys.map((storageKey) => deps.artifacts.remove(storageKey, context(spaceId))),
    );
    for (const result of cleanup) {
      if (result.status === "rejected") getLogger().error("space file cleanup", result.reason);
    }
    if (deps.secrets) await forgetPageShareSecrets(deps.secrets, deleted.pageShareSecrets);
  }
}

function adapterContext(
  operationId: string,
  userId: string,
  spaceId: string,
  botId?: string,
  signal: AbortSignal = new AbortController().signal,
): AdapterContext {
  return {
    operationId,
    traceId: operationId,
    spaceId,
    userId,
    ...(botId ? { botId } : {}),
    signal,
  };
}

/** Runs every teardown, then fails with the first error so a retry finishes the rest. */
async function settleAll(work: Promise<unknown>[]) {
  const failed = (await Promise.allSettled(work)).find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failed) throw failed.reason;
}
