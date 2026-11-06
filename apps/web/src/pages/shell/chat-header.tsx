import type { Chat } from "@labradoodle/contracts";
import { AvatarGroup, Button, DoodleAvatar, PersonAvatar } from "@labradoodle/ui-web";
import { useLingui } from "@lingui/react/macro";
import { Menu } from "lucide-react";
import { chatLabel } from "./chat-list";

/** The floating header over the transcript: navigation, and the chat's name and people. */
export function ChatHeader({
  chat,
  panelOpen,
  onOpenNavigation,
  onTogglePanel,
}: {
  chat: Chat | undefined;
  panelOpen: boolean;
  onOpenNavigation: () => void;
  onTogglePanel: () => void;
}) {
  const { t } = useLingui();
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 grid grid-cols-[1fr_minmax(0,auto)_1fr] items-center gap-2 px-3 py-[13px] md:px-[22px] [&_button]:pointer-events-auto">
      <div className="flex items-center">
        <Button
          variant="floating"
          size="icon-lg"
          aria-label={t`Open navigation`}
          onClick={onOpenNavigation}
          className="app-no-drag md:hidden"
        >
          <Menu strokeWidth={1.7} className="size-[19px]" />
        </Button>
      </div>
      {chat ? (
        <Button
          variant="floating"
          data-testid="chat-panel-trigger"
          aria-expanded={panelOpen}
          onClick={onTogglePanel}
          className="app-no-drag h-auto min-w-0 gap-2 py-1 ps-1 pe-3.5"
        >
          <ChatMembers chat={chat} size={26} />
          <span className="min-w-0 max-w-[min(20rem,50vw)]">
            <span className="block truncate text-[15px] font-medium text-foreground" dir="auto">
              {chatLabel(chat)}
            </span>
          </span>
        </Button>
      ) : (
        <span />
      )}
      <div />
    </div>
  );
}

/** Everyone in a chat, Doodle first while it is in. */
export function ChatMembers({ chat, size }: { chat: Chat; size: number }) {
  const shown = chat.members.slice(0, chat.doodle ? 3 : 4);
  return (
    <AvatarGroup className="shrink-0 -space-x-1.5">
      {chat.doodle ? (
        <span className="relative z-10 grid place-items-center rounded-full bg-background">
          <DoodleAvatar size={size} status={chat.status} />
        </span>
      ) : null}
      {shown.map((member) => (
        <PersonAvatar
          key={member.userId}
          name={member.name}
          image={member.image}
          size={size}
          className="ring-2 ring-background"
        />
      ))}
    </AvatarGroup>
  );
}
