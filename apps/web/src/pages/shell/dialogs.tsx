import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@labradoodle/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
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
  onCancel,
  onConfirm,
}: {
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
            <Trans>Clear conversation</Trans>
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

export function DeleteItemDialog({
  item,
  noun,
  title,
  description,
  onCancel,
  onConfirm,
}: {
  item: { name: string };
  noun: "page" | "routine";
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
                    noun === "page" ? t`Could not delete page` : t`Could not delete routine`,
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
