import type { ComposerMention, ComposerMentionBinding, SlashActionId } from "@labradoodle/core";
import { composerMentionSegments, mentionChipKey } from "@labradoodle/core";
import { DoodleAvatar, PersonAvatar } from "@labradoodle/ui-web";
import { t } from "@lingui/core/macro";
import { Clock, Puzzle, X } from "lucide-react";
import type { ComponentProps, ReactNode, Ref } from "react";
import { Fragment } from "react";

export function slashActionLabel(id: SlashActionId) {
  switch (id) {
    case "chat-settings":
      return t`Chat Settings`;
    case "settings-general":
      return t`Settings: General`;
    case "settings-usage":
      return t`Settings: Usage`;
  }
}

export function MentionOptionIcon({ mention }: { mention: ComposerMention }) {
  return <MentionIcon mention={mention} size={16} />;
}

function MentionCardIcon({ mention }: { mention: ComposerMention }) {
  return <MentionIcon mention={mention} size={12} />;
}

function MentionIcon({ mention, size }: { mention: ComposerMention; size: number }) {
  if (mention.kind === "routine") {
    return <Clock size={size} strokeWidth={1.7} className="shrink-0 text-muted-foreground" />;
  }
  if (mention.kind === "connector") {
    return <Puzzle size={size} strokeWidth={1.7} className="shrink-0 text-muted-foreground" />;
  }
  if (mention.kind === "person") return <PersonAvatar name={mention.name} size={size} />;
  return <DoodleAvatar size={size} />;
}

export function ComposerMentionHighlights({
  ref,
  text,
  bindings,
  targets,
  className,
}: {
  ref: Ref<HTMLDivElement>;
  text: string;
  bindings: readonly ComposerMentionBinding[];
  targets: readonly ComposerMention[];
  className: string;
}) {
  const current = new Map(targets.map((target) => [mentionChipKey(target), target]));
  return (
    <div ref={ref} inert aria-hidden className={className}>
      {composerMentionSegments(text, bindings).map((segment, index) => {
        const binding = segment.binding;
        if (!binding) return <Fragment key={index}>{segment.text}</Fragment>;
        const mention = current.get(mentionChipKey(binding.mention)) ?? binding.mention;
        return (
          <span
            key={index}
            data-testid="mention-chip"
            data-mention-kind={mention.kind}
            className="rounded-full bg-accent ring-1 ring-accent box-decoration-clone"
          >
            <span className="relative text-transparent">
              @
              <span className="absolute inset-0 grid place-items-center">
                <MentionCardIcon mention={mention} />
              </span>
            </span>
            {segment.text.slice(1)}
          </span>
        );
      })}
      {text.endsWith("\n") ? " " : null}
    </div>
  );
}

/** The selected skill, shown before the draft in the composer field. */
export function ComposerChip({
  icon,
  label,
  removeLabel,
  onRemove,
  ...props
}: {
  icon: ReactNode;
  label: string;
  removeLabel: string;
  onRemove: () => void;
} & ComponentProps<"span">) {
  return (
    <span
      {...props}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-[13px] text-foreground"
    >
      {icon}
      <span dir="auto" className="truncate">
        {label}
      </span>
      <button
        type="button"
        aria-label={removeLabel}
        onClick={onRemove}
        className="text-muted-foreground hover:text-foreground"
      >
        <X size={12} strokeWidth={2} />
      </button>
    </span>
  );
}
