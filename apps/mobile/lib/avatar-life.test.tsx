// @vitest-environment jsdom

import {
  AVATAR_CLIP_POOLS,
  AVATAR_POKES,
  avatarClip,
  avatarClipPose,
  avatarFrame,
  avatarPokeFrame,
} from "@labradoodle/core";
import type { ReactNode } from "react";
import { act, createElement, useRef } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MARK_SIZE, MARK_SPRING, ROW_HEIGHT } from "../components/activity-mark";
import { DoodleAvatar as BotAvatar } from "../components/doodle-avatar";
import {
  AvatarRow,
  AvatarScreenFocus,
  AvatarViewportScope,
  AWAKE_MS,
  createAvatarViewport,
  MORPH_SPRING,
} from "./avatar-life";

const CLOCK_MS = 24 * 60 * 60 * 1000;
const motion = vi.hoisted(() => ({
  reducedMotion: false,
  /** Every timing started: [target, duration]. */
  timings: [] as Array<[unknown, number]>,
  /** Every spring started: [target, config]. */
  springs: [] as Array<[unknown, Record<string, number> | undefined]>,
  cancelled: 0,
}));

vi.mock("react-native-reanimated", () => {
  const passthrough = ({ children, style }: { children?: ReactNode; style?: unknown }) =>
    createElement(
      "div",
      { "data-opacity": Object.assign({}, ...[style].flat()).opacity },
      children,
    );
  const easing = (value: unknown) => value;
  const fade = { duration: () => ({}) };
  return {
    default: { View: passthrough, createAnimatedComponent: () => passthrough },
    cancelAnimation: () => {
      motion.cancelled += 1;
    },
    Easing: { in: easing, out: easing, inOut: easing, quad: 0, cubic: 0, linear: 0 },
    FadeIn: fade,
    FadeOut: fade,
    ReduceMotion: { Never: "never" },
    useAnimatedProps: (worklet: () => unknown) => worklet(),
    useAnimatedStyle: (worklet: () => unknown) => worklet(),
    useReducedMotion: () => motion.reducedMotion,
    useSharedValue: <T,>(value: T) => useRef({ value }).current,
    withSpring: (value: unknown, config?: Record<string, number>) => {
      motion.springs.push([value, config]);
      return value;
    },
    withTiming: (value: unknown, config?: { duration?: number }) => {
      motion.timings.push([value, config?.duration ?? 0]);
      return value;
    },
  };
});
vi.mock("react-native-svg", () => {
  const element = ({
    children,
    fill,
    stroke,
  }: {
    children?: ReactNode;
    fill?: string;
    stroke?: string;
  }) => createElement("div", { "data-fill": fill, "data-stroke": stroke }, children);
  return { default: element, Ellipse: element, G: element, Path: element, Rect: element };
});
vi.mock("react-native", () => ({
  View: ({
    children,
    accessibilityLabel,
    style,
  }: {
    children?: ReactNode;
    accessibilityLabel?: string;
    style?: { width?: number; backgroundColor?: string; borderColor?: string };
  }) =>
    createElement(
      "div",
      {
        "aria-label": accessibilityLabel,
        "data-width": style?.width,
        "data-bg": style?.backgroundColor,
        "data-ring": style?.borderColor,
      },
      children,
    ),
  Pressable: ({ children, onPress }: { children?: ReactNode; onPress?: () => void }) =>
    createElement("button", { type: "button", onClick: onPress }, children),
  Image: () => null,
  AppState: { currentState: "active", addEventListener: () => ({ remove: () => undefined }) },
}));
vi.mock("../components/native-symbol", () => ({ NativeSymbol: () => null }));
vi.mock("./i18n", () => ({ useI18n: () => ({ t: (text: string) => text }) }));
vi.mock("./native", () => ({
  useMobileTokens: () => ({
    mutedForeground: "#888",
    background: "#FFF",
    workingDot: "#3FA266",
    secondary: "#EEE",
  }),
}));

const SHAPE = "#2A92FE::shape_2";

describe("avatar motion on mobile", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    motion.reducedMotion = false;
    motion.timings = [];
    motion.springs = [];
    motion.cancelled = 0;
    container = document.createElement("div");
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  const render = (node: ReactNode) => act(() => root.render(node));
  const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));
  const clockStarted = () => motion.timings.some(([, duration]) => duration === CLOCK_MS);
  /** The last wake-up target: 1 moving, 0 still or only blinking. */
  const awake = () =>
    motion.timings
      .filter(([target, duration]) => duration === AWAKE_MS && (target === 0 || target === 1))
      .at(-1)?.[0];
  const workingDot = () => container.querySelector('[aria-label="Working"]');

  it("keeps a resting inbox avatar a still picture: no clock, no blink", () => {
    render(<BotAvatar identity="bot-1" size={62} motion="lazy" />);
    wait(30_000);
    expect(clockStarted()).toBe(false);
  });

  it.each([
    ["a shipped shape", SHAPE],
    ["an organic avatar", "#FF781C"],
  ] as const)("plays %s's working clips in the inbox while its bot works", (_, _color) => {
    render(<BotAvatar identity="bot-1" size={62} status="running" motion="lazy" />);
    expect(clockStarted()).toBe(true);
    expect(awake()).toBe(1);
  });

  it("keeps every other avatar still, even while its bot works, and keeps the working dot", () => {
    render(<BotAvatar identity="bot-1" size={28} status="running" />);
    wait(30_000);
    expect(clockStarted()).toBe(false);
    expect(workingDot()).not.toBeNull();
  });

  it("draws the working dot as a green disc ringed in the surface colour, sized for the avatar", () => {
    render(<BotAvatar identity="bot-1" size={62} status="running" motion="lazy" />);
    expect(workingDot()?.getAttribute("data-bg")).toBe("#3FA266");
    expect(workingDot()?.getAttribute("data-ring")).toBe("#FFF");
    expect(Number(workingDot()?.getAttribute("data-width"))).toBeCloseTo(12 + 2 * 62 * 0.046);
    render(<BotAvatar identity="bot-1" size={28} status="running" />);
    expect(Number(workingDot()?.getAttribute("data-width"))).toBeCloseTo(10 + 2 * 28 * 0.046);
  });

  it("rests a bot waiting on you: no motion, no working dot", () => {
    render(<BotAvatar identity="bot-1" size={62} status="waiting_input" motion="lazy" />);
    expect(clockStarted()).toBe(false);
    expect(workingDot()).toBeNull();
  });

  it("turns into the typing dots while the bot writes its reply, and back into its face after", () => {
    render(<BotAvatar identity="bot-1" size={28} status="running" motion="running" />);
    expect(motion.springs.at(-1)?.[0]).toBe(0);
    render(<BotAvatar identity="bot-1" size={28} status="running" motion="running" composing />);
    expect(motion.springs.at(-1)).toEqual([1, MORPH_SPRING]);
    render(<BotAvatar identity="bot-1" size={28} status="running" motion="running" />);
    expect(motion.springs.at(-1)).toEqual([0, MORPH_SPRING]);
  });

  it("drops the chat header's working dot while the bot writes, and keeps it a still picture", () => {
    render(<BotAvatar identity="bot-1" size={28} status="running" composing />);
    expect(workingDot()).toBeNull();
    expect(clockStarted()).toBe(false);
    expect(motion.springs.at(-1)?.[0]).toBe(0);
  });

  it("leaves the working dot off the chat's working avatar, which is the sign itself", () => {
    render(<BotAvatar identity="bot-1" size={28} status="running" motion="running" />);
    expect(workingDot()).toBeNull();
    render(<BotAvatar identity="bot-1" size={28} status="running" motion="running" composing />);
    expect(workingDot()).toBeNull();
  });

  it("lets the call card blink at rest, without moving", () => {
    render(<BotAvatar identity="bot-1" size={28} motion="live" />);
    expect(clockStarted()).toBe(true);
    expect(awake()).toBe(0);
  });

  it("only blinks a busy avatar under Reduce Motion", () => {
    motion.reducedMotion = true;
    render(<BotAvatar identity="bot-1" size={62} status="running" motion="lazy" />);
    expect(clockStarted()).toBe(true);
    expect(awake()).toBe(0);
  });

  it("keeps a writing bot's face under Reduce Motion instead of turning it into moving dots", () => {
    motion.reducedMotion = true;
    render(<BotAvatar identity="bot-1" size={28} status="running" motion="running" composing />);
    expect(awake()).toBe(0);
    expect(motion.springs).not.toContainEqual([1, MORPH_SPRING]);
    expect(motion.springs.at(-1)?.[0]).toBe(0);
  });

  it("keeps moving 1.4 s after the bot finishes so the pose settles, then goes still", () => {
    render(<BotAvatar identity="bot-1" size={62} status="running" motion="lazy" />);
    const cancelled = motion.cancelled;
    render(<BotAvatar identity="bot-1" size={62} status="completed" motion="lazy" />);
    expect(motion.cancelled).toBe(cancelled);
    wait(1400);
    expect(motion.cancelled).toBeGreaterThan(cancelled);
  });

  it("freezes a list row's avatar while it is scrolled out of view", () => {
    const viewport = createAvatarViewport();
    render(
      <AvatarViewportScope viewport={viewport}>
        <AvatarRow id="bot-1">
          <BotAvatar identity="bot-1" size={62} status="running" motion="lazy" />
        </AvatarRow>
      </AvatarViewportScope>,
    );
    expect(clockStarted()).toBe(false);
    act(() => viewport.update(["bot-1"]));
    expect(clockStarted()).toBe(true);
  });

  it("stops on a screen behind the visible one and resumes on return", () => {
    let focused = false;
    const listeners = new Set<() => void>();
    const navigation = {
      isFocused: () => focused,
      addListener: (_event: "focus" | "blur", listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    render(
      <AvatarScreenFocus navigation={navigation}>
        <BotAvatar identity="bot-1" size={62} status="running" motion="lazy" />
      </AvatarScreenFocus>,
    );
    expect(clockStarted()).toBe(false);
    focused = true;
    act(() => {
      for (const listener of listeners) listener();
    });
    expect(clockStarted()).toBe(true);
  });
});

describe("activity mark", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    motion.reducedMotion = false;
    motion.timings = [];
    motion.springs = [];
    container = document.createElement("div");
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const _render = (node: ReactNode) => act(() => root.render(node));
  const _bots = [
    { id: "bot-a", color: SHAPE, status: "running" },
    { id: "bot-b", color: "#FF781C", status: "running" },
  ];
  const _grewIn = () => motion.springs.some(([, config]) => config === MARK_SPRING);

  it("leaves room in its row for the highest hop on top of the biggest working move", () => {
    /** How far (points) a frame lifts the top of the mark: its move up plus half its stretch. */
    const lift = (translateY: number, scaleY: number) =>
      (-translateY + (scaleY - 1) / 2) * MARK_SIZE;
    let working = 0;
    for (const name of new Set(AVATAR_CLIP_POOLS.working)) {
      const clip = avatarClip(name);
      for (let t = 0; t <= clip.duration; t += 0.01) {
        const frame = avatarFrame(avatarClipPose(clip, t), 1);
        working = Math.max(working, lift(frame.translateY, frame.scaleY));
      }
    }
    let tap = 0;
    for (const poke of AVATAR_POKES)
      for (let p = 0; p <= 1; p += 0.005) {
        const frame = avatarPokeFrame(poke, p);
        tap = Math.max(tap, lift(frame.translateY, frame.scaleY));
      }
    expect(tap).toBeGreaterThan(3);
    expect(working + tap).toBeLessThanOrEqual((ROW_HEIGHT - MARK_SIZE) / 2);
  });
});
