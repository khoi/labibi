import type { Actor } from "@labradoodle/contracts";
import type { Prisma } from "@labradoodle/db";
import { ORPCError } from "@orpc/server";

/** Serializes one owner's writes of a kind across all their spaces, until the transaction ends. */
export function lockOwner(tx: Prisma.TransactionClient, userId: string, scope: string) {
  return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${scope}:${userId}`}, 0))`;
}

const CONFLICT_MESSAGE = {
  skill: "A skill with that name already exists.",
  mcpServer: "An MCP server with that name already exists.",
} as const;

/**
 * A skill name or MCP server slug must stay unique across everything its owner added, since all
 * of it works in every space of theirs.
 */
export async function assertNameFree(
  tx: Prisma.TransactionClient,
  kind: "skill" | "mcpServer",
  actor: Pick<Actor, "userId">,
  name: string,
  excludeId?: string,
): Promise<void> {
  // Held until the caller's write commits, so two spaces can't both claim a name at once.
  await lockOwner(tx, actor.userId, `names:${kind}`);
  const other = excludeId ? { NOT: { id: excludeId } } : {};
  const select = { id: true } as const;
  const taken =
    kind === "skill"
      ? await tx.agentSkill.findMany({
          where: { userId: actor.userId, name: { equals: name, mode: "insensitive" }, ...other },
          select,
        })
      : await tx.mcpServer.findMany({
          where: { userId: actor.userId, slug: name, ...other },
          select,
        });
  if (taken.length > 0) throw new ORPCError("CONFLICT", { message: CONFLICT_MESSAGE[kind] });
}
