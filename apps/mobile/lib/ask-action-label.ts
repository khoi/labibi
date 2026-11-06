export type AskAction = { id: string; label: string };

/** The server's label on the user's-computer approval, whose "allow" covers the whole workspace. */
const ALLOW_IN_WORKSPACE = "Allow in this workspace";

export function allowsWorkspace(actions: AskAction[] | undefined): boolean {
  return actions?.some((action) => action.label === ALLOW_IN_WORKSPACE) ?? false;
}

export function askActionLabel(
  action: AskAction,
  { approval, site }: { approval: boolean; site?: string },
  t: (message: string, values?: Record<string, string | number>) => string,
): string {
  if (!approval) return action.label;
  if (action.id === "allow")
    return action.label === ALLOW_IN_WORKSPACE ? t("Allow in this workspace") : t("Allow once");
  if (action.id === "always")
    return site ? t("Always allow {site}", { site }) : t("Always allow this tool");
  if (action.id === "deny") return t("Deny");
  return action.label;
}
