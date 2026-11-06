import type { Workspace } from "@labradoodle/contracts";
import { displayName } from "@labradoodle/core";
import type { PrismaClient } from "./client.js";
import { Prisma } from "./client.js";
import { GUEST_ROLE, isOwnerRole } from "./organization-roles.js";
import type { PageShareSecret } from "./page-shares.js";
import { runAsSystem } from "./row-security.js";
import { IsolationError } from "./scope.js";
import { releasePendingSpacePayments } from "./spending.js";
import { withTransactionRetry } from "./transaction-retry.js";

export class InvalidSpaceNameError extends Error {
  constructor() {
    super("Space name must be readable and between 1 and 60 characters");
    this.name = "InvalidSpaceNameError";
  }
}

export class SpaceNotFoundError extends Error {
  constructor() {
    super("Space not found");
    this.name = "SpaceNotFoundError";
  }
}

export class CannotRenameSpaceAsNonOwnerError extends Error {
  constructor() {
    super("Only the space owner can rename it");
    this.name = "CannotRenameSpaceAsNonOwnerError";
  }
}

export class SpaceDeletionInProgressError extends Error {
  constructor() {
    super("Space deletion is already in progress");
    this.name = "SpaceDeletionInProgressError";
  }
}

export const SPACE_DELETION_CLAIM_TIMEOUT_MS = 5 * 60_000;

export function normalizeSpaceName(name: string): string {
  const trimmed = name.trim();
  if (!displayName(trimmed, "") || trimmed.length > 60) throw new InvalidSpaceNameError();
  return trimmed;
}

/**
 * The Space a member lands in after leaving or deleting one: their own default
 * Space first, then the oldest they own, then the oldest they belong to.
 */
export async function fallbackSpaceForMember(
  db: Pick<PrismaClient, "spaceMember">,
  userId: string,
  exceptSpaceId?: string,
): Promise<string | null> {
  const memberships = await db.spaceMember.findMany({
    where: {
      userId,
      space: { deletingAt: null },
      ...(exceptSpaceId ? { spaceId: { not: exceptSpaceId } } : {}),
    },
    select: { spaceId: true, role: true, space: { select: { isDefault: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const owned = memberships.filter((membership) => isOwnerRole(membership.role));
  const fallback =
    owned.find((membership) => membership.space.isDefault) ?? owned[0] ?? memberships[0];
  return fallback?.spaceId ?? null;
}

type SpaceMemberTargetInput = {
  currentSpaceId: string;
  userId: string;
  spaceId: string;
};

/** Serialize content creation with the empty-space deletion claim. */
export async function lockSpaceForContentCreation(
  tx: Prisma.TransactionClient,
  input: { spaceId: string; userId: string },
): Promise<{ organizationId: string }> {
  await tx.$queryRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${input.spaceId}, 0))::text AS "lock"
  `);
  const membership = await tx.spaceMember.findUnique({
    where: { spaceId_userId: { spaceId: input.spaceId, userId: input.userId } },
    select: {
      organizationId: true,
      space: { select: { deletingAt: true } },
    },
  });
  if (!membership) throw new IsolationError();
  if (membership.space.deletingAt) throw new SpaceDeletionInProgressError();
  return { organizationId: membership.organizationId };
}

export async function lockSpaceDeletion(
  tx: Prisma.TransactionClient,
  spaceId: string,
): Promise<void> {
  await tx.$queryRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${spaceId}, 0))::text AS "lock"
  `);
}

async function loadActorSpace(
  db: Pick<PrismaClient, "spaceMember">,
  input: SpaceMemberTargetInput,
) {
  const currentMembership = await db.spaceMember.findUnique({
    where: {
      spaceId_userId: {
        spaceId: input.currentSpaceId,
        userId: input.userId,
      },
    },
    select: { organizationId: true },
  });
  if (!currentMembership) throw new IsolationError();
  const targetMembership = await db.spaceMember.findUnique({
    where: {
      spaceId_userId: {
        spaceId: input.spaceId,
        userId: input.userId,
      },
    },
    select: {
      organizationId: true,
      role: true,
      space: { select: { isDefault: true, deletingAt: true } },
    },
  });
  if (!targetMembership || targetMembership.organizationId !== currentMembership.organizationId) {
    throw new SpaceNotFoundError();
  }
  return {
    organizationId: currentMembership.organizationId,
    role: targetMembership.role,
    isDefault: targetMembership.space.isDefault,
    deletingAt: targetMembership.space.deletingAt,
  };
}

/**
 * A person's skills, recorded demos, MCP servers and plugins work in every Space of theirs but are homed in the
 * one they were added in. Before they leave that Space, or it goes, each moves to their fallback
 * Space, a plugin with its servers and skills as one. An item whose name is taken there stays,
 * and goes with this Space.
 */
export async function rehomeMemberItems(
  tx: Prisma.TransactionClient,
  input: { spaceId: string; userId: string },
): Promise<void> {
  const { spaceId, userId } = input;
  const home = await fallbackSpaceForMember(tx, userId, spaceId);
  if (!home) return;
  const own = { spaceId, userId };
  await tx.taughtSkill.updateMany({ where: own, data: { spaceId: home } });
  const [servers, skills, installs] = await Promise.all([
    tx.mcpServer.findMany({ where: { ...own, installId: null }, select: { id: true, slug: true } }),
    tx.agentSkill.findMany({
      where: { ...own, installId: null },
      select: { id: true, name: true },
    }),
    tx.capabilityInstall.findMany({ where: own, select: { id: true } }),
  ]);
  const nameTaken = async (items: { slugs: string[]; names: string[] }) =>
    (items.slugs.length > 0 &&
      (await tx.mcpServer.count({ where: { spaceId: home, userId, slug: { in: items.slugs } } })) >
        0) ||
    (
      await Promise.all(
        items.names.map((name) =>
          tx.agentSkill.count({
            where: { spaceId: home, userId, name: { equals: name, mode: "insensitive" } },
          }),
        ),
      )
    ).some((count) => count > 0);
  for (const server of servers) {
    if (await nameTaken({ slugs: [server.slug], names: [] })) continue;
    await tx.mcpServer.update({ where: { id: server.id }, data: { spaceId: home } });
  }
  for (const skill of skills) {
    if (await nameTaken({ slugs: [], names: [skill.name] })) continue;
    await tx.agentSkill.update({ where: { id: skill.id }, data: { spaceId: home } });
  }
  for (const install of installs) {
    const parts = await Promise.all([
      tx.mcpServer.findMany({ where: { installId: install.id }, select: { slug: true } }),
      tx.agentSkill.findMany({ where: { installId: install.id }, select: { name: true } }),
    ]);
    const items = {
      slugs: parts[0].map((server) => server.slug),
      names: parts[1].map((skill) => skill.name),
    };
    if (await nameTaken(items)) continue;
    const moved = { where: { installId: install.id }, data: { spaceId: home } };
    await tx.capabilityInstall.update({ where: { id: install.id }, data: { spaceId: home } });
    await tx.mcpServer.updateMany(moved);
    await tx.agentSkill.updateMany(moved);
  }
}

/** Before a Space goes, what each member added in it moves to another Space of theirs. */
async function rehomeSpaceItems(tx: Prisma.TransactionClient, spaceId: string): Promise<void> {
  const members = await tx.spaceMember.findMany({ where: { spaceId }, select: { userId: true } });
  for (const { userId } of members) await rehomeMemberItems(tx, { spaceId, userId });
}

/**
 * Organizations that go with this account: those where everyone else is a guest, that is, the
 * people it invited into some of its Spaces.
 */
export async function personalOrganizationIds(
  prisma: Pick<PrismaClient, "member">,
  userId: string,
): Promise<string[]> {
  const memberships = await prisma.member.findMany({
    where: { userId, role: { not: GUEST_ROLE } },
    select: {
      organizationId: true,
      organization: { select: { members: { select: { userId: true, role: true } } } },
    },
  });
  return memberships
    .filter(({ organization }) =>
      organization.members.every(
        (member) => member.userId === userId || member.role === GUEST_ROLE,
      ),
    )
    .map(({ organizationId }) => organizationId);
}

/**
 * Claim the spaces that go with this account: every space of its own organizations, shared ones
 * included, and spaces elsewhere where it is the only member. A claimed space refuses new
 * content, so nobody who joins later can lose a bot to the teardown. A retry after a failed
 * deletion keeps every space this account already claimed, even one someone has since joined,
 * so the last step can release it. A space another deletion is still working on fails the
 * account deletion until that claim finishes or goes stale.
 */
export async function claimSpacesLeavingWithAccount(
  prisma: PrismaClient,
  userId: string,
): Promise<{ claimId: string; spaceIds: string[] }> {
  const organizationIds = await personalOrganizationIds(prisma, userId);
  const claimId = `account-deletion:${userId}`;
  const candidates = await prisma.space.findMany({
    where: {
      OR: [
        { organizationId: { in: organizationIds } },
        { memberships: { some: { userId }, every: { userId } } },
        // A Space they own elsewhere that only guests share (others were handed it first).
        { memberships: { some: { userId, role: "owner" } } },
        { deletionClaimId: claimId },
      ],
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  const spaceIds: string[] = [];
  for (const { id } of candidates) {
    const claimed = await withTransactionRetry(() =>
      prisma.$transaction((tx) => claimSpaceForDeletion(tx, id, claimId, userId), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }),
    );
    if (claimed) spaceIds.push(id);
  }
  return { claimId, spaceIds };
}

/**
 * Claims a Space for a whole-account or whole-organization deletion, keeping a claim it already
 * holds. Not claimed when the Space is gone or, with `soleMemberId`, someone else belongs to it.
 */
/** Guests joined through an invite and leave with the Space, so they never keep it alive. */
function otherNonGuests(spaceId: string, userId: string): Prisma.SpaceMemberWhereInput {
  return { spaceId, userId: { not: userId }, member: { role: { not: GUEST_ROLE } } };
}

export async function claimSpaceForDeletion(
  tx: Prisma.TransactionClient,
  spaceId: string,
  claimId: string,
  soleMemberId?: string,
): Promise<boolean> {
  await lockSpaceDeletion(tx, spaceId);
  const space = await tx.space.findUnique({
    where: { id: spaceId },
    select: { deletingAt: true, deletionClaimId: true },
  });
  if (!space) return false;
  if (space.deletionClaimId === claimId) return true;
  if (soleMemberId) {
    const others = await tx.spaceMember.count({ where: otherNonGuests(spaceId, soleMemberId) });
    if (others > 0) return false;
  }
  const stale = new Date(Date.now() - SPACE_DELETION_CLAIM_TIMEOUT_MS);
  if (space.deletionClaimId && space.deletingAt && space.deletingAt >= stale)
    throw new SpaceDeletionInProgressError();
  await tx.space.update({
    where: { id: spaceId },
    data: { deletingAt: new Date(), deletionClaimId: claimId },
  });
  return true;
}

/**
 * Delete a space claimed by `claimSpaceForDeletion`, once its sandboxes are gone. Rows
 * left in it go by cascade, and its keys with it. Returns the stored artifacts to remove after
 * commit, but none when another claim has since taken the space over. With `soleMemberId`, a
 * space someone joined after the claim is released instead and null is returned. With
 * `organizationId`, the organization goes in the same transaction once its last Space does, so it
 * is never left without the claim that lets a retry find it.
 */
export async function deleteClaimedSpace(
  prisma: PrismaClient,
  input: { spaceId: string; claimId: string; soleMemberId?: string; organizationId?: string },
): Promise<{ artifactKeys: string[]; pageShareSecrets: PageShareSecret[] } | null> {
  const { spaceId, claimId, soleMemberId, organizationId } = input;
  return withTransactionRetry(() =>
    prisma.$transaction(
      async (tx) => {
        await lockSpaceDeletion(tx, spaceId);
        const [others, remainingComputers, artifacts] = await Promise.all([
          soleMemberId ? tx.spaceMember.count({ where: otherNonGuests(spaceId, soleMemberId) }) : 0,
          tx.computer.count({ where: { spaceId } }),
          tx.artifact.findMany({ where: { spaceId }, select: { storageKey: true } }),
        ]);
        if (others > 0) {
          await tx.space.updateMany({
            where: { id: spaceId, deletionClaimId: claimId },
            data: { deletingAt: null, deletionClaimId: null },
          });
          return null;
        }
        // Teardown was cut short; deleting again finishes it.
        if (remainingComputers > 0) throw new SpaceDeletionInProgressError();
        await rehomeSpaceItems(tx, spaceId);
        // The page links' tokens go with the Space; the caller removes them from the store.
        const pageShareSecrets = await tx.secret.findMany({
          where: { pageShare: { is: { spaceId } } },
          select: { id: true, ciphertext: true },
        });
        await releasePendingSpacePayments(tx, spaceId);
        const gone = await tx.space.deleteMany({
          where: { id: spaceId, deletionClaimId: claimId },
        });
        if (organizationId)
          await tx.organization.deleteMany({ where: { id: organizationId, spaces: { none: {} } } });
        // The Space went to another claim: its rows and stored files are not this caller's.
        return {
          artifactKeys: gone.count > 0 ? artifacts.map((artifact) => artifact.storageKey) : [],
          pageShareSecrets: gone.count > 0 ? pageShareSecrets : [],
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}

export async function renameSpaceForMember(
  prisma: PrismaClient,
  input: SpaceMemberTargetInput & { name: string },
): Promise<{ id: string; name: string }> {
  const name = normalizeSpaceName(input.name);
  return withTransactionRetry(() =>
    prisma.$transaction(
      async (tx) => {
        await lockSpaceDeletion(tx, input.spaceId);
        const owned = await loadActorSpace(tx, input);
        if (owned.role !== "owner") throw new CannotRenameSpaceAsNonOwnerError();
        if (owned.deletingAt) throw new SpaceDeletionInProgressError();
        await tx.space.update({
          where: { id: input.spaceId },
          data: { name },
        });
        return { id: input.spaceId, name };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}

/** The workspaces a person belongs to, for the switcher; muted chats never mark one unread. */
export async function listWorkspacesForMember(
  prisma: PrismaClient,
  userId: string,
): Promise<Workspace[]> {
  const memberships = await prisma.spaceMember.findMany({
    where: { userId, space: { deletingAt: null } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      role: true,
      space: {
        select: {
          id: true,
          name: true,
          isDefault: true,
          _count: { select: { memberships: true } },
        },
      },
    },
  });
  const spaceIds = memberships.map((membership) => membership.space.id);
  // Read state is a chat row; this reads only the person's own, across their workspaces.
  const unread = await runAsSystem("find the member's workspaces with unread chats", () =>
    prisma.threadMember.findMany({
      where: { userId, unread: true, muted: false, spaceId: { in: spaceIds } },
      distinct: ["spaceId"],
      select: { spaceId: true },
    }),
  );
  const unreadSpaces = new Set(unread.map((row) => row.spaceId));
  return memberships.map(({ role, space }) => ({
    id: space.id,
    name: space.name,
    isDefault: space.isDefault,
    isOwner: isOwnerRole(role),
    shared: space._count.memberships > 1,
    unread: unreadSpaces.has(space.id),
  }));
}
