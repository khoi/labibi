import type { ComputerStatus } from "@labradoodle/contracts";
import {
  Button,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Textarea,
} from "@labradoodle/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { rpc } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";

/** Starts teaching Doodle a skill on the person's own computer. */
export function TeachComputerOverlayControl({
  computer,
  busy: busyProp,
  onRefresh,
}: {
  computer: ComputerStatus | null;
  busy?: boolean;
  onRefresh: () => Promise<void>;
}) {
  const { t } = useLingui();
  const [goalOpen, setGoalOpen] = useState(false);
  const [goal, setGoal] = useState("");
  const [localBusy, setLocalBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Sticky once a recording is known active until Shell shows Stop teaching (this
   * control unmounts) or a probe for the current bot finds no recording. Dismiss
   * may hide recovery UI but must not clear this. Do not clear it just because
   * onRefresh resolved: Shell loads skills after threads.get returns.
   */
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  /** True while the mount probe runs so Start cannot race ahead of skills.list. */
  const [syncingRecording, setSyncingRecording] = useState(true);
  const busy = Boolean(busyProp) || localBusy;
  const startLocked = needsRefresh || syncingRecording;
  const recoveryVisible = !goalOpen && needsRefresh && recoveryOpen;

  // Local needsRefresh is lost on remount and can leak across bots, so re-seed it from the
  // server, locked while the probe runs so a remount cannot start twice.
  useEffect(() => {
    let cancelled = false;
    setSyncingRecording(true);
    setGoalOpen(false);
    async function syncRecordingLock() {
      try {
        const skills = await rpc.skills.list();
        if (cancelled) return;
        const recording = skills.some((skill) => skill.status === "recording");
        if (!recording) {
          setNeedsRefresh(false);
          setRecoveryOpen(false);
          setError(null);
          return;
        }
        setNeedsRefresh(true);
        setRecoveryOpen(true);
        try {
          await onRefresh();
          // Keep needsRefresh. Shell swaps to Stop teaching once skills land.
        } catch (refreshError) {
          if (cancelled) return;
          setError(
            errorText(refreshError, t`Recording may have started, but the view could not refresh`),
          );
        }
      } catch {
        // Fail closed: a transient skills.list error must not unlock Start while
        // a recording may still be active.
        if (cancelled) return;
        setNeedsRefresh(true);
        setRecoveryOpen(true);
        setError(t`Could not check teaching status. Refresh the view to continue.`);
      } finally {
        if (!cancelled) setSyncingRecording(false);
      }
    }
    void syncRecordingLock();
    return () => {
      cancelled = true;
    };
  }, [onRefresh]); // t omitted: identity churn must not re-lock Start

  // Hide only for a desktop-host computer. Null computer still shows the control so teaching can boot.
  if (computer?.kind === "desktop") return null;

  async function refreshView() {
    setLocalBusy(true);
    setError(null);
    try {
      await onRefresh();
      // Confirm with skills.list. onRefresh can resolve before Shell applies skills.
      const skills = await rpc.skills.list();
      if (skills.some((skill) => skill.status === "recording")) {
        setNeedsRefresh(true);
        // Keep recovery open until Shell mounts Stop teaching (this control
        // unmounts). Closing here leaves a Refresh loop if Shell's skills load failed.
        setRecoveryOpen(true);
        setGoal("");
        return;
      }
      setNeedsRefresh(false);
      setRecoveryOpen(false);
      setGoal("");
    } catch (refreshError) {
      setNeedsRefresh(true);
      setRecoveryOpen(true);
      setError(
        errorText(refreshError, t`Recording may have started, but the view could not refresh`),
      );
    } finally {
      setLocalBusy(false);
    }
  }

  async function startTeaching() {
    if (!goal.trim() || busy || startLocked) return;
    const requestGoal = goal.trim();
    setLocalBusy(true);
    setError(null);
    try {
      await rpc.computer.boot();
      await rpc.skills.start({ goal: requestGoal });
      setGoalOpen(false);
      setNeedsRefresh(true);
      try {
        await onRefresh();
        setGoal("");
        // Keep needsRefresh + recovery until Shell unmounts this control when
        // recordingSkill lands. Closing recovery early hides Stop if skills lag.
        setRecoveryOpen(true);
      } catch (refreshError) {
        setRecoveryOpen(true);
        setError(
          errorText(refreshError, t`Recording may have started, but the view could not refresh`),
        );
      }
    } catch (startError) {
      const message = errorText(startError, t`Could not start teaching`);
      setError(message);
      // Server already has a session (e.g. remount before the probe finished).
      if (/already active/i.test(message)) {
        setNeedsRefresh(true);
        setRecoveryOpen(true);
        setGoalOpen(false);
      }
    } finally {
      setLocalBusy(false);
    }
  }

  function closeGoal() {
    setGoalOpen(false);
    setError(null);
  }

  return (
    <Popover
      open={goalOpen || recoveryVisible}
      onOpenChange={(open) => {
        if (!open) {
          if (goalOpen) closeGoal();
          else setRecoveryOpen(false);
          return;
        }
        if (syncingRecording) return;
        if (needsRefresh) {
          setRecoveryOpen(true);
          return;
        }
        setError(null);
        setGoalOpen(true);
      }}
    >
      <PopoverTrigger
        data-testid="teach-start-button"
        aria-label={t`Teach a task`}
        disabled={busy || syncingRecording}
        render={<Button variant="outline" size="sm" />}
      >
        <span
          aria-hidden
          className="inline-block h-2 w-2 shrink-0 rounded-full border border-foreground"
        />
        <Trans>Teach a task</Trans>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        data-testid={goalOpen ? "teach-chrome-popover" : "teach-refresh-recovery"}
        className="w-[min(360px,calc(100vw-2rem))]"
      >
        {goalOpen ? (
          <>
            <Label
              htmlFor="teach-goal-input"
              className="text-[13px] font-normal text-muted-foreground"
            >
              <Trans>What result will you demonstrate?</Trans>
            </Label>
            <Textarea
              id="teach-goal-input"
              data-testid="teach-goal-input"
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              rows={3}
              placeholder={t`Export this week's list from the CRM and drop it in the shared folder`}
            />
            {error ? (
              <div role="alert" className="text-[13px] text-destructive">
                {error}
              </div>
            ) : null}
            <div className="flex gap-2">
              <Button
                disabled={busy || startLocked || !goal.trim()}
                onClick={() => void startTeaching()}
              >
                {busy || syncingRecording ? (
                  <Trans>Starting…</Trans>
                ) : (
                  <Trans>Start recording</Trans>
                )}
              </Button>
              <Button variant="outline" onClick={closeGoal}>
                <Trans>Cancel</Trans>
              </Button>
            </div>
          </>
        ) : (
          <>
            {error ? (
              <div role="alert" className="text-[13px] text-destructive">
                {error}
              </div>
            ) : (
              <p className="text-[13px] text-muted-foreground">
                <Trans>Recording started. Refresh the view to continue.</Trans>
              </p>
            )}
            <div className="flex gap-2">
              <Button disabled={busy} onClick={() => void refreshView()}>
                {busy ? <Trans>Refreshing…</Trans> : <Trans>Refresh view</Trans>}
              </Button>
              <Button variant="outline" onClick={() => setRecoveryOpen(false)}>
                <Trans>Dismiss</Trans>
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
