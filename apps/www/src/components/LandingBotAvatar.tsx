import { BotAvatar } from "@labradoodle/ui-web";

export function LandingBotAvatar({
  color,
  identity,
  size = 38,
  className,
}: {
  color: string;
  identity?: string;
  size?: number;
  className?: string;
}) {
  return (
    <BotAvatar
      color={color}
      identity={identity}
      activity="idle"
      size={size}
      className={className}
    />
  );
}
