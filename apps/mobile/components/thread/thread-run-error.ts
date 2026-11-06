import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import type { MobileSnapshot } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { openModelSettings } from "../../lib/model-settings";
import { runErrorActionLabel } from "../../lib/run-error-presentation";
import { useRunError } from "../run-error-sheet";

/** The chat's failed run: its error, the recovery action, and whether its details are open. */
export function useThreadRunError(run: MobileSnapshot["run"] | undefined, canCustomize: boolean) {
  const { t } = useI18n();
  const router = useRouter();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const runError = run?.status === "failed" ? (run.error ?? null) : null;
  const normalizedRunError = useRunError(runError, false);
  const failedRunId = runError ? run?.id : null;
  useEffect(() => setDetailsOpen(false), [failedRunId]);
  const label = normalizedRunError ? runErrorActionLabel(t, normalizedRunError) : null;
  const runErrorAction = label
    ? {
        label,
        // Only the workspace's owner changes Doodle's model; everyone else picks their default.
        onPress:
          normalizedRunError?.recovery === "model" && canCustomize
            ? () => {
                setDetailsOpen(false);
                router.push({ pathname: "/doodle-settings", params: { focus: "model" } });
              }
            : () => {
                setDetailsOpen(false);
                openModelSettings();
              },
      }
    : null;
  return { runError, normalizedRunError, runErrorAction, detailsOpen, setDetailsOpen };
}
