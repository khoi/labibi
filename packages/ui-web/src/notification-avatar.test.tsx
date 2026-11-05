import { notificationAvatarSource } from "@labradoodle/core";
import { renderToString } from "react-dom/server";
import { expect, it } from "vitest";
import { BotAvatar } from "./bot-avatar.js";

function paths(svg: string): string[] {
  return Array.from(svg.matchAll(/<path\b[^>]*\bd="([^"]*)"/g), (match) => match[1]!);
}

it.each([
  ["seeded", "#14b8a6"],
  ["chosen shape", "#8B5CF6::shape_3"],
])("draws the %s notification portrait as the chat dood", (_, color) => {
  const bot = { id: "agent-1", color };
  const source = notificationAvatarSource(bot);
  const portrait = decodeURIComponent(source.slice(source.indexOf(",") + 1));
  const chat = renderToString(<BotAvatar color={bot.color} identity={bot.id} activity="idle" />);

  const portraitPaths = paths(portrait);
  expect(portraitPaths.length).toBeGreaterThanOrEqual(3);
  for (const d of portraitPaths) expect(paths(chat)).toContain(d);
});

it("keeps a saved photo as the notification portrait", () => {
  const photo = "data:image/png;base64,AAAA";
  expect(notificationAvatarSource({ id: "agent-1", color: photo })).toBe(photo);
});
