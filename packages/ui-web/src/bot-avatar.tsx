import type { BotColorDef, DoodShape, LogoAvatarActivity } from "@labradoodle/core";
import {
  ACTIVE_RUN_STATUSES,
  BOT_AVATAR_COLORS,
  BOT_COLOR_LIST,
  botDood,
  DEFAULT_BOT_AVATAR_COLOR,
  DOOD_SHAPES,
  doodPose,
  logoAvatarStatusActivity,
  resolvePersonaColorDef,
} from "@labradoodle/core";
import { memo, useMemo } from "react";
import { useBotAvatarActivity } from "./bot-avatar-activity.js";
import { Dood } from "./dood/dood.js";
import { cn } from "./lib/utils.js";
import "./styles.css";

export type { BotColorDef };
export { BOT_AVATAR_COLORS, BOT_COLOR_LIST, DEFAULT_BOT_AVATAR_COLOR, resolvePersonaColorDef };

export function parseBotAvatar(rawColor: string): {
  color: string;
  shapeIndex?: number;
  isImage: boolean;
  imageUrl?: string;
} {
  if (!rawColor) return { color: DEFAULT_BOT_AVATAR_COLOR, isImage: false };
  // Only data: image URLs are rendered. Arbitrary http(s)/blob values in `color`
  // must not become <img src> (SSRF / tracking when other members view the bot).
  if (rawColor.startsWith("data:image/")) {
    return { color: DEFAULT_BOT_AVATAR_COLOR, isImage: true, imageUrl: rawColor };
  }
  if (rawColor.includes("::shape_")) {
    const parts = rawColor.split("::shape_");
    const rawShapeIdx = parts[1] ?? "0";
    const parsedShapeIdx = /^\d+$/.test(rawShapeIdx) ? Number(rawShapeIdx) : 0;
    const shapeIdx = Number.isSafeInteger(parsedShapeIdx) ? parsedShapeIdx : 0;
    return {
      color: parts[0] || DEFAULT_BOT_AVATAR_COLOR,
      shapeIndex: shapeIdx % DOOD_SHAPES.length,
      isImage: false,
    };
  }
  return { color: rawColor, isImage: false };
}

const AVATAR_HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function defaultBotAvatarValue(rawColor: string): string {
  const parsed = parseBotAvatar(rawColor);
  if (rawColor && !parsed.isImage && AVATAR_HEX.test(parsed.color)) return parsed.color;
  return DEFAULT_BOT_AVATAR_COLOR;
}

export interface BotAvatarProps {
  color: string;
  activity?: LogoAvatarActivity;
  size?: number;
  status?: string;
  identity?: string;
  className?: string;
}

export const BotAvatar = memo(function BotAvatar({
  color,
  activity,
  size = 36,
  status,
  identity = "",
  className,
}: BotAvatarProps) {
  const parsed = useMemo(() => parseBotAvatar(color), [color]);
  const isWorking = ACTIVE_RUN_STATUSES.some((s) => s === status);

  if (parsed.isImage && parsed.imageUrl) {
    return (
      <div
        className={cn("labradoodle-bot-avatar relative shrink-0 select-none", className)}
        data-working={isWorking}
        style={{ width: size, height: size }}
      >
        <div className="labradoodle-bot-avatar-picture relative flex h-full w-full items-center justify-center overflow-hidden rounded-full border border-border bg-secondary">
          <img src={parsed.imageUrl} alt="" className="h-full w-full object-cover" />
        </div>
        {isWorking ? (
          <svg
            className="labradoodle-bot-avatar-ring labradoodle-bot-avatar-ring-working absolute pointer-events-none"
            style={{ inset: -4, width: size + 8, height: size + 8 }}
            viewBox="0 0 48 48"
            fill="none"
            aria-hidden="true"
          >
            <circle
              cx="24"
              cy="24"
              r="22"
              className="stroke-status-working"
              strokeWidth="3.2"
              strokeLinecap="round"
              strokeDasharray="45 80"
            />
          </svg>
        ) : null}
      </div>
    );
  }

  const Avatar = activity === undefined ? LiveDoodAvatar : DoodAvatar;
  return (
    <Avatar
      color={color}
      identity={identity || parsed.color || "agent"}
      size={size}
      status={status}
      activity={activity}
      className={className}
    />
  );
});

interface DoodAvatarProps {
  color: string;
  identity: string;
  size: number;
  status?: string;
  activity?: LogoAvatarActivity;
  className?: string;
}

/** Only avatars without a given activity subscribe to live run updates. */
function LiveDoodAvatar(props: DoodAvatarProps) {
  const activity = useBotAvatarActivity(props.identity, props.status);
  return <DoodAvatar {...props} activity={activity} />;
}

function DoodAvatar({ color, identity, size, status, activity, className }: DoodAvatarProps) {
  const dood = useMemo(() => botDood(color, identity), [color, identity]);
  const resolved = activity ?? logoAvatarStatusActivity(status);
  return (
    <Dood
      dood={dood}
      pose={doodPose(resolved)}
      size={size}
      className={cn("labradoodle-bot-avatar", className)}
    />
  );
}

/** One body in Avatar Studio's grid; omit `shapeIndex` for the body the bot's id picks. */
export function BotShapePreview({
  shapeIndex,
  identity = "preview",
  label,
  color,
  selected,
  onClick,
}: {
  shapeIndex?: number;
  identity?: string;
  label?: string;
  color: string;
  selected?: boolean;
  onClick?: () => void;
}) {
  const shape: DoodShape | undefined =
    shapeIndex === undefined ? undefined : DOOD_SHAPES[shapeIndex % DOOD_SHAPES.length];
  const value = shapeIndex === undefined ? color : `${color}::shape_${shapeIndex}`;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label ?? shape}
      aria-pressed={selected ?? false}
      className={cn(
        "relative flex size-11 items-center justify-center rounded-xl transition-transform hover:scale-105 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover",
        selected
          ? "ring-2 ring-primary ring-offset-2 ring-offset-popover bg-white/10"
          : "hover:bg-white/5",
      )}
    >
      <Dood dood={botDood(value, identity)} size={28} motion={false} />
    </button>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="flex h-11 w-11 items-center justify-center gap-1.5 rounded-full bg-card">
        <span className="h-4 w-[7px] rounded-full bg-primary" />
        <span className="h-4 w-[7px] rounded-full bg-primary" />
      </div>
      <span className="font-[Aeonik,ui-sans-serif] text-[28px] tracking-tight text-foreground">
        Labradoodle
      </span>
    </div>
  );
}
