import type { IdentityLabels } from "@labradoodle/core";
import { t } from "@lingui/core/macro";

export function identityLabels(): IdentityLabels {
  return {
    workspace: t`Workspace`,
    routine: t`Routine`,
    member: t`Member`,
    subagent: t`subagent`,
  };
}
