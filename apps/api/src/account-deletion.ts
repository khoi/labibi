import type { AdapterContext } from "@labradoodle/adapter-kit";
import {
  destroyBot,
  forgetPageShareSecrets,
  removeAgentHome,
  removeDeletedBotsFromLegacyTeamHome,
  toComputerRef,
} from "@labradoodle/adapters";
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
 * In shared spaces, the account's bot folders also live on the space's Team Computer from before
 * each person got their own. Each sandbox is destroyed at its provider before its row goes, so a
 * failure keeps the handle and deleting again resumes from what is left.
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
  // Then leave other people's Spaces, so what this account made there passes to their owners
  // instead of being torn down with it. None of them is claimed above: each keeps another full
  // member. As after leaving: tell members, stop the cancelled runs' work, free held screens,
  // and start others' waiting follow-ups.
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
    bots: leaving,
    computers: leaving,
  });

  // Pages in Spaces that stay go with the user row; their links' tokens leave the store now.
  const memberPageSecrets = await deps.prisma.$transaction((tx) =>
    deletePageShareSecrets(tx, { userId, spaceId: { notIn: spaceIds } }),
  );
  if (deps.secrets) await forgetPageShareSecrets(deps.secrets, memberPageSecrets);

  // Bot deletion cleans these best-effort; here a failure fails the account deletion, and the
  // retry finds the ids again in bot_deletions.
  const deletions = await deps.prisma.botDeletion.findMany({
    where: { deletedByUserId: userId, spaceId: { notIn: spaceIds } },
    select: { id: true, spaceId: true },
  });
  const deletedBySpace = new Map<string, string[]>();
  for (const { id, spaceId } of deletions)
    deletedBySpace.set(spaceId, [...(deletedBySpace.get(spaceId) ?? []), id]);
  await settleAll(
    [...deletedBySpace].map(([spaceId, botIds]) =>
      removeDeletedBotsFromLegacyTeamHome(deps, spaceId, botIds),
    ),
  );
}

/** Tears down the bots and computers matched, then deletes the claimed Spaces and their files. */
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
    bots: Prisma.BotWhereInput;
    computers: Prisma.ComputerWhereInput;
    signal?: AbortSignal;
  },
): Promise<void> {
  const context = (spaceId: string, botId?: string) =>
    adapterContext(input.operationId, input.userId, spaceId, botId, input.signal);
  const bots = await deps.prisma.bot.findMany({
    where: input.bots,
    select: {
      id: true,
      userId: true,
      spaceId: true,
      name: true,
      archivedAt: true,
      computerId: true,
      webhookSecretId: true,
    },
  });
  input.signal?.throwIfAborted();
  await settleAll(
    bots.map((bot) =>
      destroyBot({ ...deps, secretStore: deps.secrets }, bot, context(bot.spaceId, bot.id), {
        deleteMemories: true,
        strictTeardown: true,
      }),
    ),
  );

  const computers = await deps.prisma.computer.findMany({
    where: input.computers,
    select: {
      id: true,
      spaceId: true,
      homeKey: true,
      kind: true,
      providerRef: true,
      bots: { select: { id: true } },
    },
  });
  input.signal?.throwIfAborted();
  await settleAll(
    computers.map(async (computer) => {
      // Only someone else's bot can still be on it, and its files are theirs.
      if (computer.bots.length) {
        getLogger().warn("account.delete.computer_in_use", { "computer.id": computer.id });
        return;
      }
      if (computer.providerRef) {
        await deps.sandbox.destroy(toComputerRef(computer), context(computer.spaceId));
        await recordComputerRunEnd(deps.prisma, computer, "deleted");
      }
      await removeAgentHome(deps.home, computer.homeKey, deps.dataDir);
      // The row holds the stored home's key, so the stored copy is unreadable from here on.
      await deps.prisma.computer.deleteMany({
        where: { id: computer.id, providerRef: computer.providerRef, bots: { none: {} } },
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
