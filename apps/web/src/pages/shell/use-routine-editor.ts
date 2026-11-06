import type { Routine, ThinkingLevel, ThreadSnapshot } from "@labradoodle/contracts";
import { cronFromPreset } from "@labradoodle/core";
import { useLingui } from "@lingui/react/macro";
import type { ComponentProps, RefObject } from "react";
import { useCallback, useRef, useState } from "react";
import { localTimezone } from "../../lib/local-timezone";
import { parseModelOptionKey } from "../../lib/model-catalog";
import type { Panel } from "../../lib/right-panel-state";
import type { createSpaceRpc } from "../../lib/rpc";
import { sharedInflight } from "../../lib/shared-inflight";
import { errorText } from "../../lib/user-error";
import type { RoutineDraftState, RoutineEditor } from "../RoutineEditor";
import {
  draftFromRoutine,
  emptyRoutineDraft,
  routineNeedsOneShotArm,
  watchFromDraft,
} from "../RoutineEditor";

export function useRoutineEditor({
  rpc,
  threadId,
  activeThreadId,
  timezone,
  refreshThread,
  setPanel,
}: {
  rpc: ReturnType<typeof createSpaceRpc>;
  threadId: string | undefined;
  activeThreadId: RefObject<string | undefined>;
  timezone: string | null | undefined;
  refreshThread: (threadId: string) => Promise<ThreadSnapshot>;
  setPanel: (panel: Panel) => void;
}) {
  const { t } = useLingui();
  const [routineDraft, setRoutineDraft] = useState<RoutineDraftState>(emptyRoutineDraft());
  const [revealedWebhookSecrets, setRevealedWebhookSecrets] = useState<Record<string, string>>({});
  const [editingRoutine, setEditingRoutine] = useState<Routine | null>(null);
  const routineWebhookSecret =
    (editingRoutine && revealedWebhookSecrets[editingRoutine.id]) || null;
  const [deleteRoutineTarget, setDeleteRoutineTarget] = useState<Routine | null>(null);
  const [savingRoutine, setSavingRoutine] = useState(false);
  const [runningRoutine, setRunningRoutine] = useState(false);
  const [routineError, setRoutineError] = useState<string | null>(null);
  const routineSavePending = useRef(false);
  const webhookSecretProvisionRef = useRef(new Map<string, Promise<string>>());
  const ensureWebhookSecret = (routineId: string) =>
    sharedInflight(webhookSecretProvisionRef.current, routineId, async () => {
      const result = await rpc.routines.rotateWebhookSecret({ routineId });
      setRevealedWebhookSecrets((current) => ({ ...current, [routineId]: result.secret }));
      setEditingRoutine((current) =>
        current?.id === routineId ? { ...current, webhookConfigured: true } : current,
      );
      return result.secret;
    });
  const routineSaveRequest = useRef(0);
  const routineRunPending = useRef(false);
  const addSkillRoutine = useCallback((name: string, prompt: string) => {
    setRoutineDraft({ ...emptyRoutineDraft(), name, prompt });
    setRevealedWebhookSecrets({});
    setEditingRoutine(null);
    setPanel("routine");
  }, []);

  function restoreRoutine(routine: Routine | null) {
    setEditingRoutine(routine);
    setRoutineDraft(routine ? draftFromRoutine(routine) : emptyRoutineDraft());
    setRevealedWebhookSecrets({});
  }
  function editRoutine(routine: Routine) {
    setRoutineDraft(draftFromRoutine(routine));
    setRevealedWebhookSecrets({});
    setEditingRoutine(routine);
  }
  function startRoutine(routine?: Routine) {
    setRoutineDraft(routine ? draftFromRoutine(routine) : emptyRoutineDraft());
    setRevealedWebhookSecrets({});
    setEditingRoutine(routine ?? null);
    setRoutineError(null);
    setPanel("routine");
  }
  function resetRoutineTarget() {
    setEditingRoutine(null);
    setDeleteRoutineTarget(null);
  }
  function leaveRoutine() {
    routineSaveRequest.current += 1;
    setRoutineError(null);
  }
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const routinePath = (kind: "webhook" | "github") =>
    editingRoutine ? `${origin}/api/v1/routines/${editingRoutine.id}/${kind}` : "";
  const editorProps = threadId
    ? ({
        draft: routineDraft,
        onChange: setRoutineDraft,
        editing: editingRoutine,
        timezone: editingRoutine?.timezone ?? timezone ?? localTimezone(),
        webhook: {
          path: routinePath("webhook"),
          secret: routineWebhookSecret,
          configured: Boolean(editingRoutine?.webhookConfigured || routineWebhookSecret),
        },
        githubPath: routinePath("github"),
        saving: savingRoutine,
        running: runningRoutine,
        error: routineError,
        onBack: () => setPanel("routines"),
        onClose: () => setPanel(null),
        onEnsureWebhook: async () => {
          // A new routine gets its webhook when it is first saved.
          if (editingRoutine) await ensureWebhookSecret(editingRoutine.id);
        },
        onSave: async () => {
          if (routineSavePending.current) return;
          const targetThreadId = threadId;
          const targetRoutine = editingRoutine;
          if (targetRoutine && targetRoutine.threadId !== targetThreadId) return;
          if (
            !routineDraft.schedules.length &&
            !routineDraft.webhookEnabled &&
            !routineDraft.githubEnabled &&
            !routineDraft.watch
          ) {
            setRoutineError(t`Add a trigger to run this routine.`);
            return;
          }
          const watchResult = routineDraft.watch ? watchFromDraft(routineDraft.watch) : null;
          if (watchResult && "error" in watchResult) {
            setRoutineError(watchResult.error);
            return;
          }
          const watch = watchResult?.watch ?? null;
          const saveRequest = ++routineSaveRequest.current;
          routineSavePending.current = true;
          setSavingRoutine(true);
          setRoutineError(null);
          try {
            const crons = routineDraft.schedules.map(cronFromPreset);
            const model = routineDraft.modelKey ? parseModelOptionKey(routineDraft.modelKey) : null;
            const routineModel = {
              modelProvider: model?.provider ?? null,
              modelId: model?.modelId ?? null,
              thinkingLevel: (model && routineDraft.thinkingLevel
                ? routineDraft.thinkingLevel
                : null) as ThinkingLevel | null,
            };
            let saved: Routine;
            if (targetRoutine) {
              const armOneShot = routineNeedsOneShotArm(targetRoutine, crons);
              let runAt: string | undefined;
              if (armOneShot) {
                if (!routineDraft.runAtLocal) {
                  setRoutineError(t`Add a run time for this one-shot.`);
                  return;
                }
                const parsed = new Date(routineDraft.runAtLocal);
                if (!Number.isFinite(parsed.getTime()) || parsed.getTime() <= Date.now()) {
                  setRoutineError(t`Run time must be in the future.`);
                  return;
                }
                runAt = parsed.toISOString();
              }
              saved = await rpc.routines.update({
                routineId: targetRoutine.id,
                name: routineDraft.name || t`Routine`,
                prompt: routineDraft.prompt || t`Check in.`,
                crons,
                // Send on/off only when this save changes it, so a stale draft cannot undo a
                // disable made elsewhere since the editor opened.
                ...(armOneShot || routineDraft.active !== targetRoutine.active
                  ? { active: armOneShot ? true : routineDraft.active }
                  : {}),
                webhookEnabled: routineDraft.webhookEnabled,
                githubEnabled: routineDraft.githubEnabled,
                watch,
                ...(routineModel.modelProvider !== targetRoutine.modelProvider ||
                routineModel.modelId !== targetRoutine.modelId ||
                routineModel.thinkingLevel !== targetRoutine.thinkingLevel
                  ? routineModel
                  : {}),
                ...(runAt ? { runAt } : {}),
              });
            } else {
              saved = await rpc.routines.create({
                threadId: targetThreadId,
                name: routineDraft.name || t`Routine`,
                prompt: routineDraft.prompt || t`Check in.`,
                crons,
                timezone: timezone ?? localTimezone(),
                active: routineDraft.active,
                notify: true,
                webhookEnabled: routineDraft.webhookEnabled,
                githubEnabled: routineDraft.githubEnabled,
                watch,
                ...routineModel,
              });
            }
            if (
              (routineDraft.webhookEnabled || routineDraft.githubEnabled) &&
              !saved.webhookConfigured &&
              !revealedWebhookSecrets[saved.id]
            ) {
              await ensureWebhookSecret(saved.id);
              saved = { ...saved, webhookConfigured: true };
            }
            if (
              routineSaveRequest.current === saveRequest &&
              activeThreadId.current === targetThreadId
            ) {
              setEditingRoutine(saved);
              // Fields edited while the save was in flight keep the newer value.
              const fresh = draftFromRoutine(saved);
              setRoutineDraft(
                (current) =>
                  Object.fromEntries(
                    Object.entries(fresh).map(([key, value]) => {
                      const field = key as keyof RoutineDraftState;
                      return [key, current[field] === routineDraft[field] ? value : current[field]];
                    }),
                  ) as RoutineDraftState,
              );
            }
          } catch (error) {
            if (
              routineSaveRequest.current !== saveRequest ||
              activeThreadId.current !== targetThreadId
            ) {
              return;
            }
            setRoutineError(errorText(error, t`Could not save routine`));
            return;
          } finally {
            routineSavePending.current = false;
            setSavingRoutine(false);
          }
          if (
            routineSaveRequest.current !== saveRequest ||
            activeThreadId.current !== targetThreadId
          ) {
            return;
          }
          await refreshThread(targetThreadId).catch(() => undefined);
        },
        onTestRun: async () => {
          if (routineRunPending.current) return;
          const targetThreadId = threadId;
          const targetRoutine = editingRoutine;
          if (!targetRoutine) return;
          routineRunPending.current = true;
          setRunningRoutine(true);
          setRoutineError(null);
          try {
            await rpc.routines.testRun({ routineId: targetRoutine.id });
            await refreshThread(targetThreadId);
          } catch (error) {
            if (activeThreadId.current === targetThreadId) {
              setRoutineError(errorText(error, t`Could not run routine`));
            }
          } finally {
            routineRunPending.current = false;
            setRunningRoutine(false);
          }
        },
        onDelete: () => {
          if (editingRoutine) {
            setDeleteRoutineTarget(editingRoutine);
            return;
          }
          setPanel("routines");
        },
      } satisfies ComponentProps<typeof RoutineEditor>)
    : null;
  const deleteDialogProps = deleteRoutineTarget
    ? {
        item: deleteRoutineTarget,
        noun: "routine" as const,
        onCancel: () => setDeleteRoutineTarget(null),
        onConfirm: async () => {
          const target = deleteRoutineTarget;
          await rpc.routines.remove({ routineId: target.id });
          setDeleteRoutineTarget(null);
          setEditingRoutine((current) => (current?.id === target.id ? null : current));
          if (activeThreadId.current !== target.threadId) return;
          await refreshThread(target.threadId);
          if (activeThreadId.current === target.threadId) setPanel("routines");
        },
      }
    : null;
  return {
    editorProps,
    deleteDialogProps,
    editingRoutine,
    restoreRoutine,
    editRoutine,
    startRoutine,
    resetRoutineTarget,
    leaveRoutine,
    addSkillRoutine,
  };
}
