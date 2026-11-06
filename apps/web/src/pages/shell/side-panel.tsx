import type { Chat, SpaceMember } from "@labradoodle/contracts";
import { CHAT_NAME_MAX_LENGTH } from "@labradoodle/contracts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  DoodleAvatar,
  Input,
  PersonAvatar,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@labradoodle/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { FileText, UserPlus, X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { Suspense, useId, useRef, useState } from "react";
import { ErrorBoundary, SectionLoadFailed } from "../../components/ErrorBoundary";
import { PagesList } from "../../components/pages/PagesList";
import { lazyComponent } from "../../lib/preload-recovery";
import { useSpaceQueries } from "../../lib/query";
import type { Panel } from "../../lib/right-panel-state";
import { errorText } from "../../lib/user-error";
import { ResizableSidePanel } from "../ResizableSidePanel";
import { RoutineEditor } from "../RoutineEditor";
import { ChatMembers } from "./chat-header";
import { chatLabel, soloChat } from "./chat-list";

const KnowledgeSection = lazyComponent(() =>
  import("../KnowledgeSection").then((module) => module.KnowledgeSection),
);

type ChatTab = Exclude<Panel, "routine" | null>;

/** The panel beside the chat: its people and Doodle, its files, memory and routines. */
export function ShellSidePanel({
  panel,
  setPanel,
  chat,
  userId,
  members,
  routinesPanel,
  routineEditorProps,
  onSetDoodle,
  onAddPeople,
  onRename,
  onLeave,
  onClear,
}: {
  panel: Panel;
  setPanel: (panel: Panel) => void;
  chat: Chat | undefined;
  userId: string | undefined;
  /** Everyone in the workspace, for Add people. */
  members: readonly SpaceMember[];
  routinesPanel: ReactNode;
  routineEditorProps: ComponentProps<typeof RoutineEditor> | null;
  onSetDoodle: (doodle: boolean) => Promise<void>;
  onAddPeople: (userIds: string[]) => Promise<void>;
  onRename: (name: string | null) => Promise<void>;
  onLeave: () => void;
  onClear: () => void;
}) {
  const { t } = useLingui();
  const open = Boolean(panel && chat);
  const tab: ChatTab = panel === "routines" && !chat?.doodle ? "files" : (panel as ChatTab);
  return (
    <ResizableSidePanel open={open} panel={panel ?? "closed"}>
      {open && chat ? (
        <div className="rk-scroll h-full w-full overflow-y-auto px-5 py-[17px]">
          {panel === "routine" && routineEditorProps ? (
            <RoutineEditor {...routineEditorProps} />
          ) : (
            <div data-testid="chat-panel">
              <div className="mb-2 flex justify-end">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t`Close panel`}
                  onClick={() => setPanel(null)}
                >
                  <X size={16} strokeWidth={1.8} />
                </Button>
              </div>
              <ChatSummary
                key={chat.id}
                chat={chat}
                userId={userId}
                members={members}
                onSetDoodle={onSetDoodle}
                onAddPeople={onAddPeople}
                onRename={onRename}
                onLeave={onLeave}
                onClear={onClear}
              />
              <Tabs
                value={tab}
                onValueChange={(next) => setPanel(next as ChatTab)}
                className="mt-6"
              >
                <TabsList className="w-full">
                  <TabsTrigger value="files">
                    <Trans>Files</Trans>
                  </TabsTrigger>
                  <TabsTrigger value="memory">
                    <Trans>Memory</Trans>
                  </TabsTrigger>
                  {chat.doodle ? (
                    <TabsTrigger value="routines">
                      <Trans>Routines</Trans>
                    </TabsTrigger>
                  ) : null}
                </TabsList>
                <TabsContent value="files" className="pt-4">
                  {tab === "files" ? <ChatFiles threadId={chat.id} /> : null}
                </TabsContent>
                <TabsContent value="memory" className="pt-2">
                  {tab === "memory" ? (
                    <ErrorBoundary fallback={<SectionLoadFailed />}>
                      <Suspense fallback={null}>
                        <KnowledgeSection threadId={chat.id} />
                      </Suspense>
                    </ErrorBoundary>
                  ) : null}
                </TabsContent>
                {chat.doodle ? (
                  <TabsContent value="routines" className="pt-4">
                    {routinesPanel}
                  </TabsContent>
                ) : null}
              </Tabs>
            </div>
          )}
        </div>
      ) : null}
    </ResizableSidePanel>
  );
}

function ChatSummary({
  chat,
  userId,
  members,
  onSetDoodle,
  onAddPeople,
  onRename,
  onLeave,
  onClear,
}: {
  chat: Chat;
  userId: string | undefined;
  members: readonly SpaceMember[];
  onSetDoodle: (doodle: boolean) => Promise<void>;
  onAddPeople: (userIds: string[]) => Promise<void>;
  onRename: (name: string | null) => Promise<void>;
  onLeave: () => void;
  onClear: () => void;
}) {
  const { t } = useLingui();
  const ids = useId();
  const [error, setError] = useState<string | null>(null);
  const [doodle, setDoodle] = useState(chat.doodle);
  const [savingDoodle, setSavingDoodle] = useState(false);
  if (!savingDoodle && doodle !== chat.doodle) setDoodle(chat.doodle);
  const solo = soloChat(chat, userId);
  const addable = members.filter(
    (member) => !chat.members.some((person) => person.userId === member.userId),
  );
  async function run(action: () => Promise<void>, fallback: string) {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorText(err, fallback));
    }
  }
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col items-center gap-3 text-center">
        <ChatMembers chat={chat} size={44} />
        <ChatName chat={chat} onRename={(name) => run(() => onRename(name), t`Could not save`)} />
      </div>
      <label
        htmlFor={`${ids}-doodle`}
        className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-xl bg-muted/50 px-4"
      >
        <span className="flex items-center gap-2.5 text-sm text-foreground">
          <DoodleAvatar size={24} status={chat.status} />
          <Trans>Doodle</Trans>
        </span>
        <Switch
          id={`${ids}-doodle`}
          data-testid="chat-doodle-switch"
          checked={doodle}
          disabled={savingDoodle}
          onCheckedChange={(checked) => {
            setDoodle(checked);
            setSavingDoodle(true);
            void run(() => onSetDoodle(checked), t`Could not save`).finally(() =>
              setSavingDoodle(false),
            );
          }}
        />
      </label>
      <div className="flex flex-col gap-0.5" data-testid="chat-people">
        {chat.members.map((member) => (
          <div key={member.userId} className="flex min-h-10 items-center gap-2.5 px-1 text-sm">
            <PersonAvatar name={member.name} image={member.image} size={28} />
            <span className="min-w-0 truncate" dir="auto">
              {member.userId === userId ? t`You` : member.name}
            </span>
          </div>
        ))}
        {addable.length > 0 ? (
          <AddPeople
            people={addable}
            onAdd={(userIds) => run(() => onAddPeople(userIds), t`Could not save`)}
          />
        ) : null}
      </div>
      {error ? <p className="text-[13px] text-destructive">{error}</p> : null}
      <div className="overflow-hidden rounded-xl bg-muted/50 px-4">
        {solo ? (
          <button
            type="button"
            className="min-h-12 w-full border-b border-border text-start text-sm"
            onClick={onClear}
          >
            <Trans>Clear conversation</Trans>
          </button>
        ) : null}
        <button
          type="button"
          data-testid="chat-leave"
          className="min-h-12 w-full text-start text-sm text-destructive"
          onClick={onLeave}
        >
          {solo ? <Trans>Delete chat</Trans> : <Trans>Leave chat</Trans>}
        </button>
      </div>
    </section>
  );
}

/** The chat's name, edited in place; clearing it goes back to the people's names. */
function ChatName({ chat, onRename }: { chat: Chat; onRename: (name: string | null) => void }) {
  const { t } = useLingui();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(chat.name ?? "");
  const cancelled = useRef(false);
  function commit() {
    if (cancelled.current) return;
    setEditing(false);
    const next = draft.trim();
    if (next !== (chat.name ?? "")) onRename(next || null);
  }
  return editing ? (
    <Input
      autoFocus
      aria-label={t`Rename`}
      value={draft}
      maxLength={CHAT_NAME_MAX_LENGTH}
      placeholder={chatLabel(chat)}
      className="h-auto border-transparent bg-transparent p-0 text-center text-lg font-semibold shadow-none"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) {
          if (event.key === "Escape") event.stopPropagation();
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
        if (event.key === "Escape") {
          cancelled.current = true;
          setEditing(false);
        }
      }}
    />
  ) : (
    <button
      type="button"
      aria-label={t`Rename`}
      data-testid="chat-rename"
      className="min-w-0 max-w-full cursor-text break-words rounded px-2 text-lg font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
      dir="auto"
      onClick={() => {
        cancelled.current = false;
        setDraft(chat.name ?? "");
        setEditing(true);
      }}
    >
      {chatLabel(chat)}
    </button>
  );
}

function AddPeople({
  people,
  onAdd,
}: {
  people: readonly SpaceMember[];
  onAdd: (userIds: string[]) => Promise<void>;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            data-testid="chat-add-people"
            className="h-10 justify-start gap-2.5 px-1 text-sm font-normal"
          />
        }
      >
        <span className="grid size-7 place-items-center rounded-full bg-muted">
          <UserPlus className="size-4" aria-hidden="true" />
        </span>
        <Trans>Add people</Trans>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput placeholder={t`Search`} />
          <CommandList>
            <CommandEmpty>{t`No results`}</CommandEmpty>
            <CommandGroup>
              {people.map((person) => (
                <CommandItem
                  key={person.userId}
                  value={`${person.name} ${person.email}`}
                  onSelect={() => {
                    setOpen(false);
                    void onAdd([person.userId]);
                  }}
                >
                  <PersonAvatar name={person.name} image={person.image} size={24} />
                  <span className="min-w-0 truncate" dir="auto">
                    {person.name}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** The chat's pages and the files sent or made in it. */
function ChatFiles({ threadId }: { threadId: string }) {
  const queries = useSpaceQueries();
  const files = useInfiniteQuery(
    queries.artifacts.listSpace.infiniteOptions({
      input: (cursor: string | undefined) => ({
        threadId,
        ...(cursor ? { cursor } : {}),
        limit: 30,
      }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (page) => page.nextCursor ?? undefined,
    }),
  );
  const items = files.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <div className="flex flex-col gap-4" data-testid="chat-files">
      <PagesList threadId={threadId} />
      {items.length ? (
        <div className="flex flex-col gap-0.5">
          {items.map((item) => (
            <a
              key={item.id}
              href={`/app/artifacts/${encodeURIComponent(item.id)}`}
              className="flex min-h-10 items-center gap-2.5 rounded-lg px-2 text-sm hover:bg-accent"
            >
              <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 truncate" dir="auto">
                {item.name}
              </span>
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Confirms leaving a chat, or deleting one with nobody else in it. */
export function LeaveChatDialog({
  chat,
  solo,
  onCancel,
  onConfirm,
}: {
  chat: Chat;
  solo: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const { t } = useLingui();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="break-words">
            {solo ? t`Delete chat` : t`Leave chat`}
          </AlertDialogTitle>
        </AlertDialogHeader>
        <p className="break-words text-[13.5px] text-muted-foreground" dir="auto">
          {chatLabel(chat)}
        </p>
        {error ? <p className="text-[13.5px] text-destructive">{error}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>
            <Trans>Cancel</Trans>
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            data-testid="chat-leave-confirm"
            onClick={() => {
              setBusy(true);
              setError(null);
              void onConfirm().catch((err: unknown) => {
                setError(errorText(err));
                setBusy(false);
              });
            }}
          >
            {solo ? t`Delete chat` : t`Leave chat`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Everyone in the workspace, for picking people to chat with. */
export function useWorkspaceMembers(spaceId: string | undefined) {
  const queries = useSpaceQueries();
  return (
    useQuery({
      ...queries.spaces.members.list.queryOptions({ input: { spaceId: spaceId ?? "" } }),
      enabled: Boolean(spaceId),
    }).data?.members ?? NO_MEMBERS
  );
}

const NO_MEMBERS: SpaceMember[] = [];
