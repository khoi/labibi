import "../../src/styles.css";
import type { LogoAvatarActivity } from "@labradoodle/core";
import { BOT_AVATAR_COLORS, DOOD_SHAPES } from "@labradoodle/core";
import { BotAvatar } from "@labradoodle/ui-web";
import { createRoot } from "react-dom/client";

const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get("theme") === "light" ? "light" : "dark";

const activities: LogoAvatarActivity[] = [
  "idle",
  "thinking",
  "reading",
  "writing",
  "working",
  "waiting",
  "error",
];

createRoot(document.getElementById("root")!).render(
  <>
    <section className="row" aria-label="Bodies">
      {DOOD_SHAPES.map((shape, index) => (
        <figure key={shape}>
          <BotAvatar
            color={`${BOT_AVATAR_COLORS[index % BOT_AVATAR_COLORS.length]}::shape_${index}`}
            identity={`dood-${shape}`}
            activity="idle"
            size={72}
          />
          <figcaption>{shape}</figcaption>
        </figure>
      ))}
    </section>
    <section className="row" aria-label="Activities">
      {activities.map((activity, index) => (
        <figure key={activity}>
          <BotAvatar
            color={BOT_AVATAR_COLORS[index]!}
            identity={`dood-${activity}`}
            activity={activity}
            size={72}
          />
          <figcaption>{activity}</figcaption>
        </figure>
      ))}
    </section>
    <section className="row" aria-label="Sizes">
      {[16, 24, 36, 54].map((size) => (
        <BotAvatar key={size} color="#FFBC0A" identity="doodle" activity="idle" size={size} />
      ))}
    </section>
  </>,
);
