import type { Chat, SpaceMember } from "@labradoodle/contracts";
import { CHAT_NAME_MAX_LENGTH } from "@labradoodle/contracts";
import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Dialog,
  DialogContent,
  DialogTitle,
  DoodleAvatar,
  Input,
  PersonAvatar,
  Switch,
} from "@labradoodle/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useId, useState } from "react";
import { errorText } from "../../lib/user-error";

/**
 * Starts a chat: Doodle off unless switched on, and any people of the workspace. With nobody
 * picked it is a chat with only the person; a name is asked for once two or more are picked.
 */
export function NewChatDialog({
  open,
  onOpenChange,
  members,
  userId,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: readonly SpaceMember[];
  userId: string | undefined;
  onCreate: (input: { name?: string; userIds: string[]; doodle: boolean }) => Promise<Chat>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-md" data-testid="new-chat-dialog">
        {open ? (
          <NewChatForm
            members={members.filter((member) => member.userId !== userId)}
            onCreate={async (input) => {
              await onCreate(input);
              onOpenChange(false);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function NewChatForm({
  members,
  onCreate,
}: {
  members: readonly SpaceMember[];
  onCreate: (input: { name?: string; userIds: string[]; doodle: boolean }) => Promise<void>;
}) {
  const { t } = useLingui();
  const ids = useId();
  const [doodle, setDoodle] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const named = picked.length >= 2;

  function toggle(userId: string) {
    setPicked((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    );
  }

  async function start() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const trimmed = name.trim();
      await onCreate({
        userIds: picked,
        doodle,
        ...(named && trimmed ? { name: trimmed } : {}),
      });
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void start();
      }}
    >
      <div className="px-5 pt-5 pb-3">
        <DialogTitle>
          <Trans>New chat</Trans>
        </DialogTitle>
      </div>
      <label
        htmlFor={`${ids}-doodle`}
        className="mx-5 flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-xl bg-muted/50 px-4"
      >
        <span className="flex items-center gap-2.5 text-sm text-foreground">
          <DoodleAvatar size={24} />
          <Trans>Doodle</Trans>
        </span>
        <Switch
          id={`${ids}-doodle`}
          data-testid="new-chat-doodle"
          checked={doodle}
          onCheckedChange={setDoodle}
        />
      </label>
      {members.length > 0 ? (
        <Command className="mt-3 h-auto rounded-none! bg-transparent px-3">
          <CommandInput placeholder={t`Search`} />
          <CommandList className="max-h-64">
            <CommandEmpty>{t`No results`}</CommandEmpty>
            <CommandGroup>
              {members.map((member) => {
                const selected = picked.includes(member.userId);
                return (
                  <CommandItem
                    key={member.userId}
                    value={`${member.name} ${member.email}`}
                    data-checked={selected}
                    aria-selected={selected}
                    data-testid="new-chat-person"
                    onSelect={() => toggle(member.userId)}
                  >
                    <PersonAvatar name={member.name} image={member.image} size={28} />
                    <span className="min-w-0 flex-1 truncate" dir="auto">
                      {member.name}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      ) : null}
      {named ? (
        <div className="px-5 pt-3">
          <Input
            aria-label={t`Name`}
            placeholder={t`Name`}
            value={name}
            maxLength={CHAT_NAME_MAX_LENGTH}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
      ) : null}
      {error ? <p className="px-5 pt-3 text-[13px] text-destructive">{error}</p> : null}
      <div className="flex justify-end px-5 pt-4 pb-5">
        <Button type="submit" disabled={busy} data-testid="new-chat-start">
          <Trans>Start chat</Trans>
        </Button>
      </div>
    </form>
  );
}
