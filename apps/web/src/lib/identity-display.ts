import type { IdentityLabels } from "@labradoodle/core";
import { DOODLE_NAME } from "@labradoodle/core";
import { t } from "@lingui/core/macro";

export function identityLabels(): IdentityLabels {
  return {
    bot: DOODLE_NAME,
    group: t`Chat`,
    space: t`Workspace`,
    routine: t`Routine`,
    member: t`Member`,
    subagent: t`subagent`,
    owner: t`Owner`,
  };
}
