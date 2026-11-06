import { randomBytes } from "node:crypto";
import { personalWorkspaceName, signupPolicyFromEnv } from "@labradoodle/core";
import { ensureFirstChat } from "./chats.js";
import type { Prisma, PrismaClient } from "./client.js";
import { ensureSpaceDoodle } from "./doodle.js";

export interface SignupPolicyEnv {
  signupsEnabled: string | undefined;
  signupAllowlist: string | undefined;
}

const SHARED_WORKSPACE = { name: "Labradoodle", slug: "labradoodle" };

type OrganizationClient = Pick<
  Prisma.TransactionClient,
  | "organization"
  | "member"
  | "space"
  | "spaceMember"
  | "memoryDocument"
  | "notificationPreference"
  | "bot"
>;

function newId(): string {
  return randomBytes(16).toString("hex");
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

/**
 * An organization owned by `userId`, with a default Space of the same id and name and its Doodle. Each step
 * joins an existing row instead of failing, so a concurrent call with the same slug converges.
 * Returns the organization's id, which is also its default Space's.
 */
export async function createOrganizationWithDefaultSpace(
  prisma: OrganizationClient,
  input: { userId: string; orgId: string; name: string; slug: string },
): Promise<string> {
  const { userId, name, slug } = input;
  let orgId = input.orgId;
  try {
    await prisma.organization.create({
      data: { id: orgId, name, slug, createdAt: new Date() },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    orgId = (await prisma.organization.findUniqueOrThrow({ where: { slug } })).id;
  }
  // Before the Space, so the trigger joining members to the default Space finds none and the
  // SpaceMember below cannot collide, which would abort a caller's transaction.
  await prisma.member
    .create({
      data: { id: newId(), organizationId: orgId, userId, role: "owner", createdAt: new Date() },
    })
    .catch((error: unknown) => {
      if (!isUniqueViolation(error)) throw error;
    });
  await prisma.space
    .create({
      data: {
        id: orgId,
        organizationId: orgId,
        name,
        isDefault: true,
        createdByUserId: userId,
        createdAt: new Date(),
      },
    })
    .catch((error: unknown) => {
      if (!isUniqueViolation(error)) throw error;
    });
  await ensureSpaceDoodle(prisma, orgId);
  await prisma.spaceMember
    .create({
      data: {
        id: newId(),
        spaceId: orgId,
        organizationId: orgId,
        userId,
        role: "owner",
        createdAt: new Date(),
      },
    })
    .catch((error: unknown) => {
      if (!isUniqueViolation(error)) throw error;
    });
  const hasMemory = await prisma.memoryDocument.findFirst({
    where: { spaceId: orgId, userId, threadId: null, path: "MEMORY.md" },
  });
  if (!hasMemory) {
    await prisma.memoryDocument
      .create({
        data: {
          spaceId: orgId,
          userId,
          path: "MEMORY.md",
          content: "# My memory\n\n",
        },
      })
      .catch((error: unknown) => {
        if (!isUniqueViolation(error)) throw error;
      });
  }
  await prisma.notificationPreference
    .create({ data: { spaceId: orgId, userId } })
    .catch((error: unknown) => {
      if (!isUniqueViolation(error)) throw error;
    });
  return orgId;
}

/**
 * Put the person in the one workspace everyone shares. Whoever finds none creates and owns it;
 * everyone else joins as a member, so it outlives its owner's account like any team workspace.
 * Returns null while it is being deleted.
 */
export async function joinSharedWorkspace(
  prisma: PrismaClient,
  userId: string,
): Promise<string | null> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('labradoodle:shared-workspace'))`;
    const existing = await tx.organization.findUnique({
      where: { slug: SHARED_WORKSPACE.slug },
      select: { id: true, spaces: { where: { isDefault: true }, select: { deletingAt: true } } },
    });
    if (!existing) {
      return createOrganizationWithDefaultSpace(tx, {
        userId,
        orgId: newId(),
        ...SHARED_WORKSPACE,
      });
    }
    if (existing.spaces[0]?.deletingAt !== null) return null;
    const organizationId = existing.id;
    const now = new Date();
    await tx.member.upsert({
      where: { organizationId_userId: { organizationId, userId } },
      create: { id: newId(), organizationId, userId, role: "member", createdAt: now },
      update: {},
    });
    await tx.spaceMember.upsert({
      where: { spaceId_userId: { spaceId: organizationId, userId } },
      create: { id: newId(), spaceId: organizationId, organizationId, userId, createdAt: now },
      update: {},
    });
    return organizationId;
  });
}

/**
 * Provision the shared workspace membership, then the person's own workspace, and a first chat
 * with Doodle in the shared one. Joined first, the shared workspace is the one a new session
 * opens. Signup never grants deployment administration.
 */
export async function bootstrapUserSpace(
  prisma: PrismaClient,
  user: { id: string; name?: string | null; email?: string | null },
  env: SignupPolicyEnv,
): Promise<{ spaceId: string }> {
  const sharedSpaceId = await joinSharedWorkspace(prisma, user.id);
  // Concurrent bootstraps for the same user (e.g. overlapping first phone inbounds) share the slug.
  const ownSpaceId = await createOrganizationWithDefaultSpace(prisma, {
    userId: user.id,
    orgId: newId(),
    name: personalWorkspaceName(user),
    slug: `user-${user.id.slice(0, 12)}`,
  });
  const spaceId = sharedSpaceId ?? ownSpaceId;
  const policy = signupPolicyFromEnv(env);
  await prisma.deploymentSettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      ownerUserId: null,
      signupsEnabled: policy.enabled,
      signupAllowlist: policy.allowlist.join(","),
      signupPolicyInitialized: true,
    },
    update: {},
  });
  await ensureFirstChat(prisma, { spaceId, userId: user.id });
  return { spaceId };
}
