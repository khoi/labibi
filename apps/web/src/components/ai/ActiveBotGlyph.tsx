import type { GroupAvatarMember } from "@labradoodle/ui-web";
import { GroupAvatar } from "@labradoodle/ui-web";

/** The working bot with what it is doing right now, such as its current tool call. */
export function ActiveBotGlyph({ bots, label }: { bots: GroupAvatarMember[]; label: string }) {
  return (
    <div role="status" className="flex min-h-10 min-w-0 items-center gap-2.5 px-1">
      <GroupAvatar members={bots} size={28} />
      <span dir="auto" className="min-w-0 truncate text-[15px] text-muted-foreground text-shimmer">
        {label}
      </span>
    </div>
  );
}
