import type { Bot } from "@labradoodle/contracts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  RadioGroup,
  RadioGroupItem,
} from "@labradoodle/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useId, useState } from "react";
import { errorText } from "../../lib/user-error";

/** Each dialog is mounted only while open, so `open` is always true and the
 * parent unmounts it from `onCancel`. Escape and backdrop presses are ignored
 * while a request is in flight. */
function closeUnlessBusy(busy: boolean, onCancel: () => void) {
  return (open: boolean) => {
    if (!open && !busy) onCancel();
  };
}

export function ClearConversationDialog({
  bot,
  onCancel,
  onConfirm,
}: {
  bot: Pick<Bot, "name">;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const { t } = useLingui();
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <AlertDialog open onOpenChange={closeUnlessBusy(clearing, onCancel)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="break-words">
            <Trans>Clear {bot.name}’s conversation?</Trans>
          </AlertDialogTitle>
          <AlertDialogDescription>
            <Trans>
              This permanently removes every message and stops current work. The chat remains
              available.
            </Trans>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? <p className="text-[13.5px] text-destructive">{error}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={clearing}>
            <Trans>Cancel</Trans>
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={clearing}
            onClick={() => {
              setClearing(true);
              setError(null);
              void onConfirm().catch((err: unknown) => {
                setError(errorText(err, t`Could not clear conversation`));
                setClearing(false);
              });
            }}
          >
            {clearing ? <Trans>Clearing…</Trans> : <Trans>Clear</Trans>}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function DeleteBotDialog({
  bot,
  onCancel,
  onConfirm,
}: {
  bot: Bot;
  onCancel: () => void;
  onConfirm: (deleteMemories: boolean) => Promise<void>;
}) {
  const { t } = useLingui();
  const [deleting, setDeleting] = useState(false);
  const [deleteMemories, setDeleteMemories] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const memoriesLabelId = useId();

  return (
    <AlertDialog open onOpenChange={closeUnlessBusy(deleting, onCancel)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="break-words">
            <Trans>Delete {bot.name}?</Trans>
          </AlertDialogTitle>
          <AlertDialogDescription>
            <Trans>
              Its conversation, files, and routines will be permanently deleted. Bots it created
              stay in your list.
            </Trans>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <p id={memoriesLabelId} className="mb-2 text-[13.5px] text-foreground/75">
            <Trans>What about its memories?</Trans>
          </p>
          <RadioGroup
            aria-labelledby={memoriesLabelId}
            value={deleteMemories ? "delete" : "keep"}
            onValueChange={(value) => setDeleteMemories(value === "delete")}
          >
            {/* biome-ignore lint/a11y/noLabelWithoutControl: the wrapped RadioGroupItem is the control. */}
            <label className="flex cursor-pointer gap-3 rounded-lg border border-border p-3">
              <RadioGroupItem value="keep" className="mt-0.5" />
              <span>
                <span className="block text-[14px] text-foreground">
                  <Trans>Keep memories</Trans>
                </span>
                <span className="mt-0.5 block text-[12.5px] text-muted-foreground">
                  <Trans>Move them to your shared memory.</Trans>
                </span>
              </span>
            </label>
            {/* biome-ignore lint/a11y/noLabelWithoutControl: the wrapped RadioGroupItem is the control. */}
            <label className="flex cursor-pointer gap-3 rounded-lg border border-border p-3">
              <RadioGroupItem value="delete" className="mt-0.5" />
              <span>
                <span className="block text-[14px] text-foreground">
                  <Trans>Delete memories too</Trans>
                </span>
                <span className="mt-0.5 block text-[12.5px] text-muted-foreground">
                  <Trans>This cannot be undone.</Trans>
                </span>
              </span>
            </label>
          </RadioGroup>
        </div>
        {error ? <p className="text-[13.5px] text-destructive">{error}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>
            <Trans>Cancel</Trans>
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={deleting}
            onClick={() => {
              setDeleting(true);
              setError(null);
              void onConfirm(deleteMemories).catch((err: unknown) => {
                setError(errorText(err, t`Could not delete bot`));
                setDeleting(false);
              });
            }}
          >
            {deleting ? <Trans>Deleting…</Trans> : <Trans>Delete</Trans>}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The space the Space settings section acts on. */
export type SettingsSpace = {
  id: string;
  name: string;
  canRename?: boolean;
};
export function DeleteItemDialog({
  item,
  noun,
  title,
  description,
  onCancel,
  onConfirm,
}: {
  item: { name: string };
  noun: "group" | "page" | "routine" | "space";
  title?: React.ReactNode;
  description?: React.ReactNode;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const { t } = useLingui();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <AlertDialog open onOpenChange={closeUnlessBusy(deleting, onCancel)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title ?? <Trans>Delete {item.name}?</Trans>}</AlertDialogTitle>
          <AlertDialogDescription>
            {description ?? <Trans>This cannot be undone.</Trans>}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? <p className="text-[13.5px] text-destructive">{error}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>
            <Trans>Cancel</Trans>
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={deleting}
            onClick={() => {
              setDeleting(true);
              setError(null);
              void onConfirm().catch((err: unknown) => {
                setError(
                  errorText(
                    err,
                    noun === "group"
                      ? t`Could not delete group`
                      : noun === "space"
                        ? t`Could not delete space`
                        : noun === "page"
                          ? t`Could not delete page`
                          : t`Could not delete routine`,
                  ),
                );
                setDeleting(false);
              });
            }}
          >
            {deleting ? <Trans>Deleting…</Trans> : <Trans>Delete</Trans>}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
