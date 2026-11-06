import type { Chat } from "@labradoodle/contracts";
import { DoodleAvatar, PersonAvatar } from "@labradoodle/ui-web";

/** The other people in a chat, or Doodle (else the viewer) in a chat with only them. */
export function ChatAvatar({
  chat,
  userId,
  size,
}: {
  chat: Pick<Chat, "doodle" | "members" | "status">;
  userId: string | undefined;
  size: number;
}) {
  const others = chat.members.filter((member) => member.userId !== userId);
  const [first, second] = others;
  if (!first) {
    const me = chat.members[0];
    return chat.doodle || !me ? (
      <DoodleAvatar size={size} status={chat.status} />
    ) : (
      <PersonAvatar name={me.name} image={me.image} size={size} />
    );
  }
  if (!second) return <PersonAvatar name={first.name} image={first.image} size={size} />;
  const small = Math.round(size * 0.68);
  return (
    <span className="relative shrink-0" style={{ width: size, height: size }}>
      <PersonAvatar
        name={first.name}
        image={first.image}
        size={small}
        className="absolute start-0 top-0"
      />
      <PersonAvatar
        name={second.name}
        image={second.image}
        size={small}
        className="absolute end-0 bottom-0 ring-2 ring-sidebar"
      />
    </span>
  );
}
