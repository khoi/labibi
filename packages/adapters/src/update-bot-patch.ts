import type { PrismaClient } from "@labradoodle/db";
import { requireSpaceOwner, SpaceOwnerRequiredError } from "@labradoodle/db";

/** Providers send omitted optional fields as null or blank; only anything else counts as given. */
export function argumentGiven(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  return typeof value !== "string" || value.trim().length > 0;
}

export const OWNER_ONLY_SETTINGS_ERROR =
  "Only the workspace's owner can change Doodle's settings. Tell the person that the owner can.";

/** Whether the person a run acts for owns its workspace, the only one who sets up Doodle. */
export async function isSpaceOwner(
  prisma: Pick<PrismaClient, "spaceMember">,
  actor: { spaceId: string; userId: string },
): Promise<boolean> {
  try {
    await requireSpaceOwner(prisma, actor);
    return true;
  } catch (error) {
    if (error instanceof SpaceOwnerRequiredError) return false;
    throw error;
  }
}
