import { DoodleAvatar } from "@labradoodle/ui-web";

/** Doodle at work, with what it is doing right now, such as its current tool call. */
export function ActiveBotGlyph({ label }: { label: string }) {
  return (
    <div role="status" className="flex min-h-10 min-w-0 items-center gap-2.5 px-1">
      <DoodleAvatar size={28} status="running" />
      <span dir="auto" className="min-w-0 truncate text-[15px] text-muted-foreground text-shimmer">
        {label}
      </span>
    </div>
  );
}
