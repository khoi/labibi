import type { PrismaClient } from "./client.js";
import { Prisma } from "./client.js";

type Scope = { userId: string };
type ConfirmationsTx = ConfirmationsClient & Pick<Prisma.TransactionClient, "$queryRaw">;
type ConfirmationsClient = Pick<
  PrismaClient,
  "userActionApprovalRule" | "userActionAutoReviewPreference"
>;

/** A stored effect's batch actions, or undefined when the effect is not a batch. */
export function storedBatchActions(
  value: Prisma.JsonValue | null | undefined,
): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((action): action is string => typeof action === "string");
}

export type ApprovalRuleInput = { effect: string; matchKind: string; matchValue: string };
export type AutoReviewPreference = { enabled: boolean; skipApprovals: boolean };

export async function listApprovalRules(prisma: ConfirmationsClient, scope: Scope) {
  return prisma.userActionApprovalRule.findMany({
    where: { userId: scope.userId },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Saves a rule once and drops any other effect on the same match, so a match has one rule.
 * Matching ignores case, so the replacement does too; the lock keeps concurrent saves of
 * different effects from both landing. Runs inside the caller's transaction.
 */
export async function saveApprovalRule(tx: ConfirmationsTx, scope: Scope, rule: ApprovalRuleInput) {
  const value = rule.matchValue.toLowerCase();
  await tx.$queryRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${`approval-rule:account:${scope.userId}:${rule.matchKind}:${value}`}, 0))::text AS "lock"
  `);
  // One rule per match, whatever its effect or spelling. Compared here, not with Prisma's
  // insensitive mode: that is ILIKE, where "_" is a wildcard.
  const select = { id: true, effect: true, matchValue: true } as const;
  const rows = await tx.userActionApprovalRule.findMany({
    where: { userId: scope.userId, matchKind: rule.matchKind },
    select,
  });
  const ids = rows
    .filter((row) => row.matchValue.toLowerCase() === value)
    .filter((row) => row.effect !== rule.effect || row.matchValue !== rule.matchValue)
    .map((row) => row.id);
  await tx.userActionApprovalRule.deleteMany({ where: { id: { in: ids } } });
  const row = { userId: scope.userId, ...rule };
  return tx.userActionApprovalRule.upsert({
    where: { userId_effect_matchKind_matchValue: row },
    create: row,
    update: {},
  });
}

export async function removeApprovalRule(prisma: ConfirmationsClient, scope: Scope, id: string) {
  await prisma.userActionApprovalRule.deleteMany({ where: { id, userId: scope.userId } });
}

export async function findAutoReviewPreference(
  prisma: ConfirmationsClient,
  scope: Scope,
): Promise<AutoReviewPreference | null> {
  return prisma.userActionAutoReviewPreference.findUnique({
    where: { userId: scope.userId },
    select: { enabled: true, skipApprovals: true },
  });
}

/** Updates the given fields; a first save fills the rest from `defaults`. */
export async function saveAutoReviewPreference(
  prisma: ConfirmationsClient,
  scope: Scope,
  update: Partial<AutoReviewPreference>,
  defaults: AutoReviewPreference,
) {
  await prisma.userActionAutoReviewPreference.upsert({
    where: { userId: scope.userId },
    create: {
      userId: scope.userId,
      enabled: update.enabled ?? defaults.enabled,
      skipApprovals: update.skipApprovals ?? defaults.skipApprovals,
    },
    update,
  });
}
