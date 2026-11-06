import type { LogoAvatarActivity } from "@labradoodle/core";
import { DOODLE_DOOD, doodPose, logoAvatarStatusActivity } from "@labradoodle/core";
import { memo } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "./components/ui/avatar.js";
import { Dood } from "./dood/dood.js";
import { cn } from "./lib/utils.js";

/** Doodle, the same look everywhere; `status` is what it is doing in the chat shown. */
export const DoodleAvatar = memo(function DoodleAvatar({
  size = 36,
  status,
  activity,
  className,
}: {
  size?: number;
  status?: string;
  activity?: LogoAvatarActivity;
  className?: string;
}) {
  return (
    <Dood
      dood={DOODLE_DOOD}
      pose={doodPose(activity ?? logoAvatarStatusActivity(status))}
      size={size}
      className={cn("labradoodle-bot-avatar shrink-0", className)}
    />
  );
});

/** A person: their picture, else the first letter of their name. */
export const PersonAvatar = memo(function PersonAvatar({
  name,
  image,
  size = 36,
  className,
}: {
  name: string;
  image?: string | null;
  size?: number;
  className?: string;
}) {
  const initial = name.match(/[\p{L}\p{N}]/u)?.[0]?.toUpperCase() ?? "";
  return (
    <Avatar className={cn("shrink-0", className)} style={{ width: size, height: size }}>
      {image ? <AvatarImage src={image} alt="" /> : null}
      <AvatarFallback style={{ fontSize: Math.max(10, Math.round(size * 0.42)) }}>
        {initial}
      </AvatarFallback>
    </Avatar>
  );
});
