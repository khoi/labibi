import type { IdentityLabels } from "@labradoodle/core";
import { t } from "@lingui/core/macro";

export function identityLabels(): IdentityLabels {
  return {
    bot: t`Bot`,
    group: t`Group`,
    space: t`Space`,
    routine: t`Routine`,
    member: t`Member`,
    subagent: t`subagent`,
    owner: t`Owner`,
  };
}
