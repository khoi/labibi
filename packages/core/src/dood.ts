import { parseBotAvatarValue } from "@labradoodle/contracts";
import { resolvePersonaColorDef, shippedHash } from "./bot-avatar-colors.js";
import type { LogoAvatarActivity } from "./logo-avatar-activity.js";

/** The eight bodies, in the order a saved `::shape_N` avatar picks them. */
export const DOOD_SHAPES = ['box', 'coil', 'circle', 'loop', 'squiggle', 'star', 'triangle', 'wave'] as const;
export type DoodShape = (typeof DOOD_SHAPES)[number];

export const DOOD_COLORS = ["yellow", "blue", "pink", "orange", "green", "lightPink", "grey"] as const;
export type DoodColor = (typeof DOOD_COLORS)[number];

/** Resting eyes. `cross` is only an expression, shown when a run fails. */
export const DOOD_RESTING_EYES = ["round", "arch", "flat", "pill"] as const;
export type DoodEyes = (typeof DOOD_RESTING_EYES)[number] | "cross";

export interface Dood {
  shape: DoodShape;
  color: DoodColor;
  eyes: DoodEyes;
}

export type DoodState = "done" | "idle" | "thinking" | "working";
export type DoodForm = "self" | "bolt" | "bubble" | "bulb" | "heart" | "pen" | "question" | "search";

export interface DoodPose {
  state: DoodState;
  form: DoodForm;
  eyes?: DoodEyes;
}

/** Each body's hand-drawn stroke in the 24px box; every body is stroked 2.4 wide, round. */
export const DOOD_PATHS: Record<DoodShape, string> = {
  box:
    "M17.26 4.99C13.87 4.99 6.57 5.03 3.75 6.91C2.62 7.66 1.35 15.95 2.38 17.09C3.6 18.44 16.86 22.85 18.75 21.86C20.32 21.04 22.54 2.06 19.89 2C16.44 1.93 8.55 3.4 5.39 4.8C4.21 5.33 5.13 18.24 6.48 20.03C7.47 21.34 20.5 18.84 21.79 17.43C22.78 16.35 20.07 7.31 18.75 7.6C15.25 8.38 9.56 7.03 6.6 8.87C5.55 9.53 7.86 15.81 8.61 17.09C9.43 18.5 15.57 16.62 17.26 15.52",
  coil:
    "M10.56 2C5.57 3.75 1.44 8.8 2.88 10.19C4.38 11.63 9.5 10.12 10.56 9.49C12.26 8.47 16.68 6.19 15.61 4.22C14.59 2.34 6.1 7.15 3.57 13.34C3.08 14.53 2.26 15.94 2.87 17.04C4.04 19.15 8.03 17.59 12.28 15.31C17.46 12.54 22.79 9.49 21.09 6.91C18.57 3.07 4.67 15.43 6.72 19.9C8.67 24.17 15.33 20.05 17.09 18.69C17.79 18.15 21.64 14.76 20.46 14.05C18.14 12.63 12.27 17.67 11.5 19.29C9.92 22.59 16.64 22.83 20.46 20.25",
  circle:
    "M18.75 7.44C17.9 5.12 8.26 0.95 6.17 9.77C4.08 18.58 7.41 20.99 13.22 20.99C19.84 21.24 24 13.2 21.02 7.44C13.9 -6.32 1.07 20.81 14.94 18.6C22.02 17.48 17.2 -1.98 6.17 4.22C1.21 6.77 0.36 16.08 5.33 19.23C10.29 22.39 17.62 17.27 15.93 12.05",
  loop:
    "M2 20.97C10.42 16.76 12.63 6.24 11.16 3.91C9.58 1.41 6.35 4.36 5.68 9.25C5.01 14.14 5.56 20.24 10 20.97C14.84 21.76 22.32 7.32 17.37 7.32C10.31 7.32 14.74 28.13 22 16.76",
  squiggle:
    "M8.5 2C3.97 3.61 1.06 7.66 2.28 9.62C3.29 11.24 8.83 9.3 9.78 8.72C11.33 7.78 14.83 5.94 13.86 4.12C12.75 2.05 0.36 9.03 2.27 15.94C3.5 20.39 23.16 9.98 19.43 6.36C15.6 2.64 3.91 14.45 5.77 18.57C9.06 25.86 20.01 15.2 18.27 13.17C16.64 11.28 11.74 15.87 10.71 18.57C7.82 26.13 26.29 20.03 21.06 11.43C17.46 7.42 9.21 11.26 5.13 13.17",
  star:
    "M2.84 19.44C2.84 19.43 2.85 18.65 2.87 17.41C2.88 16.77 3.12 16.01 3.42 15.05C3.56 14.61 3.65 14.44 4.42 13C5.15 11.63 6.62 8.99 7.72 7.15C8.83 5.32 9.53 4.36 9.94 3.81C10.66 2.85 11.22 2.46 11.75 2.15C11.98 2.01 12.55 2 13.26 2C14.1 2 14.88 3.02 15.54 3.89C15.91 4.38 16.42 5.41 17.03 6.68C17.65 7.96 18.3 9.5 18.72 10.49C19.15 11.48 19.33 11.88 19.56 12.56C19.8 13.25 20.08 14.22 20.28 14.93C20.87 17.1 20.64 18.5 20.51 18.66C19.92 19.4 18.27 19.65 16.92 19.85C15.24 20.11 13.91 19.86 13.2 19.66C12.84 19.56 12.5 19.43 11.57 18.9C10.64 18.37 9.13 17.43 8.01 16.66C6.89 15.89 6.21 15.31 5.33 14.39C4.45 13.47 3.39 12.22 2.83 11.55C2.21 10.81 2.12 10.62 2.04 10.3C1.93 9.82 2.07 9.37 2.24 9.08C2.68 8.34 3.75 7.95 5.06 7.55C6.01 7.25 7.59 6.97 10.14 6.78C12.69 6.6 16.18 6.57 18.03 6.57C20.22 6.57 20.68 6.91 21.18 7.31C21.68 7.7 21.81 8.36 21.95 9.37C22.07 10.27 21.96 10.92 21.8 11.46C21.45 12.69 20.89 13.84 20.42 14.53C20.02 15.13 19.35 15.69 17.8 16.67C16.66 17.37 14.69 18.25 12.88 19.04C11.07 19.82 9.45 20.43 8.11 20.89C6.76 21.35 5.73 21.64 5.12 21.8C4.36 22 3.91 22.01 3.44 21.99C3.16 21.98 3.01 21.82 2.89 21.66C2.77 21.52 2.77 21.02 2.79 20.31C2.81 19.75 3.19 19.18 4.13 18.03C4.81 17.19 7.35 14.93 9.7 14.93",
  triangle:
    "M17.04 10.44C17.04 10.26 16.98 9.69 16.37 8.33C15.64 6.7 14.15 5.23 12.96 4.04C11.44 2.5 10.79 2.38 10.16 2.12C9.83 1.99 9.45 1.97 9.04 2.04C8.04 2.21 7.31 3.94 6.07 6.23C5.3 7.67 4.37 9.75 3.7 11.44C3.04 13.13 2.7 14.38 2.46 15.39C1.7 18.6 2.05 20.5 2.32 21.13C2.44 21.41 2.74 21.55 3.02 21.69C3.34 21.86 3.76 21.9 6.86 21.96C9.76 22.01 15.35 22 18.28 21.99C21.22 21.98 21.33 21.94 21.44 21.87C21.67 21.71 21.82 21.46 21.92 20.88C22.13 19.68 21.93 18.67 21.08 16.62C20.3 14.76 18.77 11.27 17.85 9.24C16.73 6.73 16.25 6.06 15.88 5.61C14.85 4.38 12.96 3.97 11.78 3.98C11.44 3.98 10.34 5.4 8.73 7.33C7.43 8.89 6.6 11.37 6.31 12.32C6.18 12.73 6.18 14.49 6.21 17.06C6.22 18.67 6.59 19.41 6.75 19.73C7.03 20.26 8.97 20.57 10.85 20.8C14.39 21.23 15.23 20.58 16.3 19.99C17.08 19.56 17.97 18.63 18.5 17.91C19.1 17.08 18.34 15.23 17.67 13.7C17.08 12.36 15.75 10.98 14.63 9.74C14.2 9.27 13.75 8.99 13.23 8.63C13.08 8.53 12.86 8.52 12.67 8.5C12.48 8.48 12.3 8.47 12.08 8.76C11.48 9.54 11.08 10.56 10.25 11.55C9.69 12.21 8.84 13.17 8.31 13.74C7.79 14.31 7.62 14.47 7.18 14.82",
  wave:
    "M21.27 22C19.22 21.77 4.07 21.32 4.28 18.38C4.52 15.03 11.98 16.49 12.9 16.52C19.27 16.72 20.7 16.8 21.81 15.8C22.06 15.58 22.04 15.16 21.88 14.88C21.72 14.59 21.36 14.35 18.22 13.84C15.08 13.33 9.17 12.55 6 12.11C5.67 12.06 0.98 12.27 2.2 9.79C3.18 7.82 6.6 7.21 10.72 6.67C13.16 6.35 16.32 6.66 18.11 6.69C20.24 6.74 20.95 6.47 21.5 6.09C22.44 5.45 20.23 3.38 19.95 3.15C19.68 2.97 19.44 2.85 17.53 2.67C15.62 2.49 12.05 2.25 8.38 2",
};

export const DOOD_VIEWBOX = "0 0 24 24";
export const DOOD_STROKE_WIDTH = 2.4;

/** Each colour's resting stroke, and the tone it runs through while it works. */
export const DOOD_INK: Record<DoodColor, { ink: string; tone: string }> = {
  yellow: { ink: "#FFBC0A", tone: "#FFEB0A" },
  blue: { ink: "#1E98F5", tone: "#1EBFF5" },
  pink: { ink: "#ED6095", tone: "#ED60AE" },
  orange: { ink: "#FE6F02", tone: "#FE9C02" },
  green: { ink: "#4FAA52", tone: "#4FAA72" },
  lightPink: { ink: "#FAB5E3", tone: "#E5B5FA" },
  grey: { ink: "#9D9C9B", tone: "#C1C0C0" },
};

/** Eyes on a light page; on a dark one they turn light. */
export const DOOD_EYE_INK = { light: "#1A1A1A", dark: "#F4F4F5" } as const;

interface EyeBox {
  height: number;
  radii: readonly [number, number, number, number];
  width: number;
  x: number;
  y: number;
}

const unit = 16 / 60;
const full = 11 * unit;
const soft = 8 * unit;
const roundBox = { height: 22 * unit, width: 22 * unit, x: 3.2, y: 5.07 };

function pair(eye: EyeBox): readonly [EyeBox, EyeBox] {
  return [eye, { ...eye, x: eye.x + 44 * unit }];
}

const EYE_BOXES: Record<Exclude<DoodEyes, "cross">, readonly [EyeBox, EyeBox]> = {
  round: pair({ ...roundBox, radii: [full, full, full, full] }),
  arch: pair({ ...roundBox, radii: [full, full, soft, soft] }),
  flat: pair({ ...roundBox, radii: [soft, soft, full, full] }),
  pill: pair({ height: 26 * unit, width: 16 * unit, x: 4, y: 4.53, radii: [8 * unit, 8 * unit, 8 * unit, 8 * unit] }),
};

/** Eyes close and glance about this point of the 24px box. */
export const DOOD_EYE_ORIGIN = { x: 12, y: 8 } as const;

const CROSS = {
  arm: 25.42 * unit,
  thickness: 9.53 * unit,
  centers: [
    [6.58, 8.08],
    [17.24, 8.07],
  ],
} as const;

const round2 = (value: number) => Math.round(value * 100) / 100;

function eyeBoxPath({ height, radii, width, x, y }: EyeBox): string {
  const [tl, tr, br, bl] = radii.map((r) => Math.min(r, width / 2, height / 2)) as [number, number, number, number];
  return [
    `M${round2(x + tl)} ${round2(y)}`,
    `H${round2(x + width - tr)}`,
    `A${round2(tr)} ${round2(tr)} 0 0 1 ${round2(x + width)} ${round2(y + tr)}`,
    `V${round2(y + height - br)}`,
    `A${round2(br)} ${round2(br)} 0 0 1 ${round2(x + width - br)} ${round2(y + height)}`,
    `H${round2(x + bl)}`,
    `A${round2(bl)} ${round2(bl)} 0 0 1 ${round2(x)} ${round2(y + height - bl)}`,
    `V${round2(y + tl)}`,
    `A${round2(tl)} ${round2(tl)} 0 0 1 ${round2(x + tl)} ${round2(y)}`,
    "Z",
  ].join("");
}

function capsulePath(cx: number, cy: number, width: number, height: number): string {
  return eyeBoxPath({ x: cx - width / 2, y: cy - height / 2, width, height, radii: [9, 9, 9, 9] });
}

/** Each eye as filled paths in the 24px box; a cross eye is two capsules turned 45 degrees. */
export function doodEyeShapes(eyes: DoodEyes): { d: string; rotate?: { cx: number; cy: number } }[] {
  if (eyes === "cross") {
    return CROSS.centers.flatMap(([cx, cy]) => [
      { d: capsulePath(cx, cy, CROSS.thickness, CROSS.arm), rotate: { cx, cy } },
      { d: capsulePath(cx, cy, CROSS.arm, CROSS.thickness), rotate: { cx, cy } },
    ]);
  }
  return EYE_BOXES[eyes].map((box) => ({ d: eyeBoxPath(box) }));
}

/**
 * The dood a bot is drawn as. A saved Avatar Studio shape picks the body; otherwise the bot's id
 * does, so every bot keeps one stable look. The colour is the bot's identity colour.
 */
export function botDood(color: string, identity: string): Dood {
  const parsed = parseBotAvatarValue(color);
  const seed = shippedHash(`dood/v1/${identity || color}`);
  const shape =
    parsed.kind === "shape"
      ? DOOD_SHAPES[parsed.shapeIndex % DOOD_SHAPES.length]!
      : DOOD_SHAPES[seed % DOOD_SHAPES.length]!;
  const def = resolvePersonaColorDef(identity, parsed.kind === "other" || parsed.kind === "image" ? undefined : parsed.color);
  return {
    shape,
    color: (DOOD_COLORS as readonly string[]).includes(def.id) ? (def.id as DoodColor) : "yellow",
    eyes: DOOD_RESTING_EYES[(seed >>> 8) % DOOD_RESTING_EYES.length]!,
  };
}

/** What a dood does for each public activity a bot can be in. */
export function doodPose(activity: LogoAvatarActivity): DoodPose {
  switch (activity) {
    case "reading":
      return { state: "working", form: "search" };
    case "writing":
      return { state: "working", form: "pen" };
    case "thinking":
      return { state: "thinking", form: "bulb" };
    case "computer":
    case "working":
      return { state: "working", form: "self" };
    case "waiting":
      return { state: "idle", form: "question" };
    case "error":
      return { state: "idle", form: "self", eyes: "cross" };
    case "idle":
      return { state: "idle", form: "self" };
  }
}

/** A still dood as standalone SVG markup, for surfaces that cannot run script (notifications). */
export function doodSvgMarkup(dood: Dood, options: { size: number; eyeInk: string }): string {
  const eyes = doodEyeShapes(dood.eyes)
    .map(({ d, rotate }) =>
      rotate ? `<path d="${d}" transform="rotate(-45 ${rotate.cx} ${rotate.cy})"/>` : `<path d="${d}"/>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${options.size}" height="${options.size}" viewBox="-2 -2 28 28"><path d="${DOOD_PATHS[dood.shape]}" fill="none" stroke="${DOOD_INK[dood.color].ink}" stroke-width="${DOOD_STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round"/><g fill="${options.eyeInk}">${eyes}</g></svg>`;
}
