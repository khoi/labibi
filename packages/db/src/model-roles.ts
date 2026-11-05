import type { ModelRole, ModelRoleChoice, ModelRoleSettings } from "@labradoodle/contracts";
import {
  backupChoiceKey,
  canonicalPiProviderId,
  modelRoleChoiceKey,
  ThinkingLevelSchema,
} from "@labradoodle/contracts";
import type { PrismaClient } from "./client.js";
import { Prisma } from "./client.js";
import { withTransactionRetry } from "./transaction-retry.js";

/** Whose models: a member's choices are theirs in every Space. */
type Owner = { userId: string };
type RoleClient = Pick<PrismaClient, "userModelRoleChoice">;
type StoredChoice = {
  role: string;
  position: number;
  provider: string;
  modelId: string;
  thinkingLevel: string | null;
  credentialId: string | null;
};
const storedChoice = {
  role: true,
  position: true,
  provider: true,
  modelId: true,
  thinkingLevel: true,
  credentialId: true,
} as const;

function roleChoice(row: StoredChoice): ModelRoleChoice {
  const thinkingLevel = ThinkingLevelSchema.safeParse(row.thinkingLevel);
  return {
    provider: row.provider,
    modelId: row.modelId,
    ...(thinkingLevel.success ? { thinkingLevel: thinkingLevel.data } : {}),
    ...(row.credentialId ? { credentialId: row.credentialId } : {}),
  };
}

/** The member's own ordered models for a purpose; empty when the deployment's defaults apply. */
export async function getModelRole(
  prisma: RoleClient,
  owner: Owner,
  role: ModelRole,
): Promise<ModelRoleSettings> {
  const rows = await prisma.userModelRoleChoice.findMany({
    where: { userId: owner.userId, role },
    orderBy: [{ position: "asc" }],
    select: storedChoice,
  });
  const primary = rows.find((row) => row.position === 0);
  return {
    primary: primary ? roleChoice(primary) : null,
    backups: rows.filter((row) => row.position > 0).map(roleChoice),
  };
}

/** Every purpose's models, each purpose's in order. */
export async function listModelRoleChoices(
  prisma: RoleClient,
  owner: Owner,
): Promise<Array<ModelRoleChoice & { role: string; position: number }>> {
  const rows = await prisma.userModelRoleChoice.findMany({
    where: { userId: owner.userId },
    orderBy: [{ role: "asc" }, { position: "asc" }],
    select: storedChoice,
  });
  return rows.map((row) => ({ ...roleChoice(row), role: row.role, position: row.position }));
}

/** Saves a purpose's list. Saves queue on the user, so each rewrite sees the previous one. */
export async function updateModelRole(
  prisma: PrismaClient,
  owner: Owner,
  role: ModelRole,
  patch: Partial<ModelRoleSettings>,
): Promise<ModelRoleSettings> {
  return withTransactionRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const users = await tx.$queryRaw<Array<{ locked: number }>>`
          SELECT 1 AS locked FROM "user" WHERE "id" = ${owner.userId} FOR UPDATE
        `;
        if (users.length !== 1) throw new Error("Model settings owner not found");
        return writeModelRole(tx, owner, role, patch);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    ),
  );
}

/**
 * Rewrites a purpose's ordered list inside the caller's transaction. A choice without a
 * thinking level keeps the one its model already had, so reordering never resets effort.
 */
export async function writeModelRole(
  tx: RoleClient,
  owner: Owner,
  role: ModelRole,
  patch: Partial<ModelRoleSettings>,
): Promise<ModelRoleSettings> {
  const current = await getModelRole(tx, owner, role);
  const saved = [...(current.primary ? [current.primary] : []), ...current.backups];
  // The same row first, then the same model on another connection.
  const savedThinking = (choice: ModelRoleChoice) =>
    (
      saved.find((item) => modelRoleChoiceKey(item) === modelRoleChoiceKey(choice)) ??
      saved.find((item) => backupChoiceKey(item) === backupChoiceKey(choice))
    )?.thinkingLevel ?? null;
  // Apps that predate connections send rows without one; a row keeps the connection its
  // model already ran on when only one connection did.
  const savedConnection = (choice: ModelRoleChoice) => {
    const owners = saved.filter((item) => backupChoiceKey(item) === backupChoiceKey(choice));
    return owners.length === 1 ? owners[0]!.credentialId : undefined;
  };
  const withThinking = (choice: ModelRoleChoice): ModelRoleChoice => {
    const credentialId =
      choice.credentialId !== undefined ? choice.credentialId : savedConnection(choice);
    return {
      ...choice,
      provider: canonicalPiProviderId(choice.provider),
      ...(credentialId ? { credentialId } : {}),
      thinkingLevel:
        choice.thinkingLevel !== undefined ? choice.thinkingLevel : savedThinking(choice),
    };
  };
  const primary =
    patch.primary === undefined ? current.primary : patch.primary && withThinking(patch.primary);
  // The primary already runs first, so a matching fallback would never be tried.
  const backups = (patch.backups ?? current.backups)
    .map(withThinking)
    .filter(
      (backup, index, list) =>
        (!primary || modelRoleChoiceKey(backup) !== modelRoleChoiceKey(primary)) &&
        list.findIndex((item) => modelRoleChoiceKey(item) === modelRoleChoiceKey(backup)) === index,
    );
  await tx.userModelRoleChoice.deleteMany({ where: { userId: owner.userId, role } });
  await tx.userModelRoleChoice.createMany({
    data: [
      ...(primary ? [{ ...primary, position: 0 }] : []),
      ...backups.map((backup, index) => ({ ...backup, position: index + 1 })),
    ].map((row) => ({
      userId: owner.userId,
      role,
      position: row.position,
      provider: row.provider,
      modelId: row.modelId,
      thinkingLevel: row.thinkingLevel ?? null,
      credentialId: row.credentialId ?? null,
    })),
  });
  return getModelRole(tx, owner, role);
}
