import type { IdentityLabels } from "@labradoodle/core";
import { t } from "./i18n";

export function identityLabels(): IdentityLabels {
  return {
    workspace: t("Workspace"),
    routine: t("Routine"),
    member: t("Member"),
    subagent: t("subagent"),
  };
}
