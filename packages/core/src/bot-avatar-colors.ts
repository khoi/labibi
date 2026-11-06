import { parseBotAvatarValue } from "@labradoodle/contracts";

export interface BotColorDef {
  id: string;
  name: string;
  /** The bot's one color: its dood, name and bubble all start from it. */
  hex: string;
  /** Colors bots were saved with before the dood palette; they resolve to this one. */
  legacyHexes?: readonly string[];
}

/** The seven dood inks. Every bot wears one of them. */
export const BOT_COLOR_LIST: BotColorDef[] = [
  { id: "yellow", name: "Yellow", hex: "#FFBC0A", legacyHexes: ["#FFAF38", "#EAB308"] },
  {
    id: "blue",
    name: "Blue",
    hex: "#1E98F5",
    legacyHexes: ["#2A92FE", "#3B82F6", "#1CC3B0", "#06B6D4"],
  },
  {
    id: "pink",
    name: "Pink",
    hex: "#ED6095",
    legacyHexes: ["#FF5EB1", "#EC4899", "#FF3E51", "#EF4444"],
  },
  {
    id: "orange",
    name: "Orange",
    hex: "#FE6F02",
    legacyHexes: ["#FF781C", "#F97316", "#A27952", "#8D6E63"],
  },
  { id: "green", name: "Green", hex: "#4FAA52", legacyHexes: ["#00C972", "#10B981"] },
  { id: "lightPink", name: "Lilac", hex: "#FAB5E3", legacyHexes: ["#A97EFE", "#8B5CF6"] },
  {
    id: "grey",
    name: "Grey",
    hex: "#9D9C9B",
    legacyHexes: ["#94A3B8", "#64748B", "#FFFFFF"],
  },
];

export const BOT_AVATAR_COLORS = BOT_COLOR_LIST.map((c) => c.hex);

/** Doodle's yellow, the color a bot starts from. */
export const DEFAULT_BOT_AVATAR_COLOR = BOT_COLOR_LIST[0]!.hex;

export function shippedHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}

export function shippedRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 1831565813) | 0;
    let next = Math.imul(value ^ (value >>> 15), 1 | value);
    next = (next + Math.imul(next ^ (next >>> 7), 61 | next)) ^ next;
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

export function resolvePersonaColorDef(
  identity: string,
  explicitColor?: string | null,
): BotColorDef {
  if (explicitColor) {
    const lower = explicitColor.toLowerCase();
    const clean = /^#[0-9a-f]{3}$/.test(lower) ? `#${expandHex(lower)}` : lower;
    const found = BOT_COLOR_LIST.find(
      (c) =>
        c.id.toLowerCase() === clean ||
        c.name.toLowerCase() === clean ||
        c.hex.toLowerCase() === clean ||
        c.legacyHexes?.some((hex) => hex.toLowerCase() === clean),
    );
    if (found) return found;
    if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(explicitColor))
      return nearestBotColor(explicitColor);
  }
  const seed = (shippedHash(identity) ^ Math.imul(1, 2654435769)) >>> 0;
  const index = Math.floor(shippedRandom((seed ^ 2654435769) >>> 0)() * BOT_COLOR_LIST.length);
  return BOT_COLOR_LIST[index % BOT_COLOR_LIST.length] ?? BOT_COLOR_LIST[0]!;
}

/** Any other saved hex wears the closest ink, by OKLab distance. */
function nearestBotColor(hex: string): BotColorDef {
  const toLab = (value: string) => {
    const [l, c, h] = hexToOklch(value);
    return [l, c * Math.cos(h), c * Math.sin(h)] as const;
  };
  const [l, a, b] = toLab(hex);
  let best = BOT_COLOR_LIST[0]!;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const color of BOT_COLOR_LIST) {
    const [cl, ca, cb] = toLab(color.hex);
    const distance = (l - cl) ** 2 + (a - ca) ** 2 + (b - cb) ** 2;
    if (distance < bestDistance) {
      best = color;
      bestDistance = distance;
    }
  }
  return best;
}

/** WCAG AA contrast for body text. */
const BUBBLE_TEXT_CONTRAST = 4.5;
const LIGHT_TEXT = "#FFFFFF";

/**
 * Your messages in a bot's chat wear that bot's color under white text, deepened just enough for
 * AA contrast. The color darkens in OKLCH so it keeps its hue and saturation instead of turning
 * muddy. Photo avatars keep the neutral bubble.
 */
export function chatUserBubbleColors(
  avatarValue: string,
  identity: string,
): { background: string; foreground: string } | undefined {
  const parsed = parseBotAvatarValue(avatarValue);
  if (parsed.kind === "image") return undefined;
  const def = resolvePersonaColorDef(identity, parsed.kind === "other" ? undefined : parsed.color);
  let background = `#${expandHex(def.hex)}`.toUpperCase();
  const [lightness, chroma, hue] = hexToOklch(background);
  for (let l = lightness; contrastRatio(background, LIGHT_TEXT) < BUBBLE_TEXT_CONTRAST; ) {
    l -= 0.01;
    background = oklchToHex(l, chroma, hue);
  }
  return { background, foreground: LIGHT_TEXT };
}

function hexToOklch(hex: string): [number, number, number] {
  const c = expandHex(hex);
  const [r, g, b] = [0, 2, 4].map((offset) => {
    const channel = (Number.parseInt(c.substring(offset, offset + 2), 16) || 0) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [lightness, Math.hypot(a, bb), Math.atan2(bb, a)];
}

function oklchToHex(lightness: number, chroma: number, hue: number): string {
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return `#${linear
    .map((value) => {
      const v = Math.min(1, Math.max(0, value));
      const srgb = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
      return Math.round(srgb * 255)
        .toString(16)
        .padStart(2, "0");
    })
    .join("")}`.toUpperCase();
}

/**
 * Which ink a bot's eyes take. They are cut-outs in the page color (dark in dark mode, light in
 * light mode), unless the body is pale or dark enough that the cut-out would fade in one theme;
 * then they stay the ink that contrasts with the body. Amber, emerald and cyan are pale enough.
 */
export function botEyeTone(bodyHex: string): "page" | "dark" | "light" {
  if (contrastRatio(bodyHex, "#FFFFFF") < 2.4) return "dark";
  if (contrastRatio(bodyHex, "#000000") < 2) return "light";
  return "page";
}

/** The eye ink {@link botEyeTone} picks, on a page with these two colors. */
export function botEyeInk(bodyColor: string, page: { background: string; foreground: string }) {
  const tone = botEyeTone(bodyColor);
  if (tone === "page") return page.background;
  const [darker, lighter] =
    contrastRatio(page.background, "#FFFFFF") > contrastRatio(page.foreground, "#FFFFFF")
      ? [page.background, page.foreground]
      : [page.foreground, page.background];
  return tone === "dark" ? darker : lighter;
}

/** WCAG contrast ratio between two hex colors. */
export function contrastRatio(a: string, b: string): number {
  const [high, low] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05);
}

function relativeLuminance(hex: string): number {
  const c = expandHex(hex);
  const [r, g, b] = [0, 2, 4].map((offset) => {
    const channel = (Number.parseInt(c.substring(offset, offset + 2), 16) || 0) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function expandHex(hex: string): string {
  const c = hex.replace("#", "");
  if (c.length === 3) {
    const r = c[0] ?? "0";
    const g = c[1] ?? "0";
    const b = c[2] ?? "0";
    return `${r}${r}${g}${g}${b}${b}`;
  }
  return c;
}
