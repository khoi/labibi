/** The org role of someone who belongs to an organization only through Spaces they were invited to. */
export const GUEST_ROLE = "guest";

/** Better Auth stores roles as a comma-separated list. */
export function isOwnerRole(role: string): boolean {
  return role
    .split(",")
    .map((value) => value.trim())
    .includes("owner");
}
