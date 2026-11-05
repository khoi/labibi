import { BotAvatarValueSchema, parseBotAvatarValue } from "@labradoodle/contracts";
import { botDood, DOOD_EYE_INK, doodSvgMarkup } from "./dood.js";

/** A static notification portrait, with the same identity, saved photo and dood as chat. */
export function notificationAvatarSource(bot: { id: string; color: string }): string {
  const valid = BotAvatarValueSchema.safeParse(bot.color).success;
  const parsed = valid ? parseBotAvatarValue(bot.color) : null;
  if (parsed?.kind === "image") return parsed.imageUrl;
  // The push is flattened onto white, so the eyes are inked for a light page.
  const markup = doodSvgMarkup(botDood(valid ? bot.color : "", bot.id), {
    size: 96,
    eyeInk: DOOD_EYE_INK.light,
  });
  return `data:image/svg+xml,${encodeURIComponent(markup)}`;
}
