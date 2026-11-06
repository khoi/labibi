import { isIdentityConfirmationRequired } from "@labradoodle/contracts";
import { Button, Spinner } from "@labradoodle/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";
import { useIdentityConfirmation } from "./ConfirmIdentityDialog";
import { SettingsRow } from "./SettingsRows";

export function AccountDataSettings() {
  const { t } = useLingui();
  const { withIdentityConfirmation, identityDialog } = useIdentityConfirmation();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function exportData() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const { token } = await withIdentityConfirmation(() => rpc.export.accountToken());
      // A download link, not a fetch, so the browser or Electron saves the stream natively.
      const link = document.createElement("a");
      link.href = `/api/account/export?token=${encodeURIComponent(token)}`;
      link.download = "";
      link.click();
    } catch (cause) {
      if (!isIdentityConfirmationRequired(cause)) setError(errorText(cause, t`Could not continue`));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <SettingsRow
        label={<Trans>Your data</Trans>}
        control={
          <Button
            variant="secondary"
            size="sm"
            aria-label={t`Export data`}
            data-testid="account-export"
            disabled={pending}
            aria-busy={pending}
            onClick={() => void exportData()}
          >
            {pending ? <Spinner aria-hidden /> : null}
            <Trans>Export</Trans>
          </Button>
        }
      >
        {error ? (
          <p role="alert" className="mt-2 text-[12.5px] text-destructive">
            {error}
          </p>
        ) : null}
      </SettingsRow>
      {identityDialog}
    </>
  );
}
