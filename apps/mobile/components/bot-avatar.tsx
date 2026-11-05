import { parseBotAvatarValue } from "@labradoodle/contracts";
import type { AvatarMotionMode, Dood, LogoAvatarActivity } from "@labradoodle/core";
import {
  AVATAR_LID_CLOSE,
  AVATAR_MOTION_UNITS,
  AVATAR_TYPING_DOTS,
  avatarClip,
  avatarClock,
  avatarFrame,
  avatarLifeState,
  avatarPokeFrame,
  avatarRestingBlink,
  avatarSchedulePose,
  avatarThinkingDot,
  avatarWorkingDot,
  botAvatarActivity,
  botDood,
  DOOD_EYE_ORIGIN,
  DOOD_INK,
  DOOD_PATHS,
  DOOD_STROKE_WIDTH,
  DOOD_VIEWBOX,
  doodEyeShapes,
  isRunWorking,
} from "@labradoodle/core";
import { memo, useMemo, useSyncExternalStore } from "react";
import { Image, Pressable, View } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion } from "react-native-reanimated";
import Svg, { G, Path } from "react-native-svg";
import type { AvatarLife } from "../lib/avatar-life";
import { useAvatarOnScreen, useLife, usePoke, useSettling } from "../lib/avatar-life";
import { useI18n } from "../lib/i18n";
import { mobileLogoAvatarActivity } from "../lib/logo-avatar-activity";
import { useMobileTokens } from "../lib/native";
import { NativeSymbol } from "./native-symbol";

/** How far (0–1) the face has turned into the typing dots, for a morph of 0–1. */
function morphGrow(morph: number): number {
  "worklet";
  const t = Math.min(Math.max(morph, 0), 1);
  return t * t * (3 - 2 * t);
}
/** The face shrinks until it is the size of the middle typing dot. */
const MORPH_SHRINK = 1 - (2 * AVATAR_TYPING_DOTS.radius) / AVATAR_MOTION_UNITS;
/** The avatar's flat frame right now, a tap poke included; a worklet. */
function liveFrame(life: AvatarLife) {
  "worklet";
  const now = life.seconds.value;
  const segments = life.schedule.value;
  const pose = avatarSchedulePose(segments, now);
  const frame = avatarFrame(pose, life.awake.value);
  if (life.awake.value < 1) {
    // Resting and Reduce Motion blinks: the authored blink times, with the resting blink.
    let shut = 0;
    for (const segment of segments) {
      if (!segment.clip || segment.start > now) continue;
      const clip = avatarClip(segment.clip);
      for (const blink of clip.blinks ?? [])
        shut = Math.max(shut, avatarRestingBlink(now - segment.start - blink));
    }
    frame.lid = Math.min(frame.lid, 1 - AVATAR_LID_CLOSE * shut);
  }
  const poke = life.poke.value;
  if (poke) {
    const extra = avatarPokeFrame(poke, life.pokeProgress.value);
    frame.rotate += extra.rotate;
    frame.translateY += extra.translateY;
    frame.scaleY *= extra.scaleY;
    frame.eyeY += extra.eyeY;
  }
  // The face shrinks into the middle typing dot while the bot writes.
  const grow = morphGrow(life.morph.value);
  frame.scaleX *= 1 - MORPH_SHRINK * grow;
  frame.scaleY *= 1 - MORPH_SHRINK * grow;
  return { frame, grow };
}

/** The body transform for an avatar `size` points wide. */
function useBodyStyle(life: AvatarLife, size: number) {
  return useAnimatedStyle(() => {
    const { frame, grow } = liveFrame(life);
    return {
      opacity: 1 - grow,
      transform: [
        { translateX: frame.translateX * size },
        { translateY: frame.translateY * size },
        { rotate: `${frame.rotate}deg` },
        { scaleX: frame.scaleX },
        { scaleY: frame.scaleY },
      ],
    };
  });
}

/** An eye's offset (motion units), its height and whether it shows. */
function eyeState(life: AvatarLife) {
  "worklet";
  const { frame, grow } = liveFrame(life);
  return { x: frame.eyeX, y: frame.eyeY, lid: frame.lid, hidden: grow >= 0.5 };
}

export interface BotAvatarProps {
  color: string;
  size?: number;
  status?: string;
  identity?: string;
  activity?: LogoAvatarActivity;
  muted?: boolean;
  /**
   * How the avatar may move: still (the default), lazy (inbox rows and pinned chats: still
   * at rest, moving while the bot is busy), live (the call card: also blinks at rest) or
   * running (the activity mark in a chat).
   */
  motion?: AvatarMotionMode;
  /**
   * The bot is writing its reply: a moving avatar turns into the typing dots, and no avatar
   * shows the working dot.
   */
  composing?: boolean;
  /** A tap plays a little reaction (the activity mark). */
  pokeable?: boolean;
}

export const BotAvatar = memo(function BotAvatar({
  color,
  size = 54,
  status,
  identity,
  activity,
  muted = false,
  motion = "static",
  composing = false,
  pokeable = false,
}: BotAvatarProps) {
  const tokens = useMobileTokens();
  const liveActivity = useSyncExternalStore(
    mobileLogoAvatarActivity.subscribe,
    () => mobileLogoAvatarActivity.getActivity(identity ?? "", status),
    (): LogoAvatarActivity => "idle",
  );
  const resolved = botAvatarActivity({ color }, activity ?? liveActivity);
  const writing = composing || resolved === "writing";
  const state = avatarLifeState(status, writing);
  // The working dot marks a bot at work, not one writing its reply; a running avatar is
  // itself that sign, so it carries none.
  const isWorking = isRunWorking(status) && !writing && motion !== "running";
  const parsed = parseBotAvatarValue(color);
  const dood = useMemo(() => botDood(color, identity ?? ""), [color, identity]);
  const onScreen = useAvatarOnScreen();
  const reducedMotion = useReducedMotion();
  const settling = useSettling(state);
  const clock = avatarClock({
    mode: motion,
    onScreen,
    hasEyes: parsed.kind !== "image",
    size,
    state,
    settling,
    reducedMotion,
  });
  const life = useLife(state, clock, size, motion);
  const poke = usePoke(life, pokeable && clock === "running");
  const bodyStyle = useBodyStyle(life, size);
  const picture =
    parsed.kind === "image" && parsed.imageUrl ? (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          overflow: "hidden",
          // A plain circle holds the photo's place while it loads, or if it fails to.
          backgroundColor: tokens.secondary,
        }}
      >
        <Image source={{ uri: parsed.imageUrl }} style={{ width: size, height: size }} />
      </View>
    ) : (
      <DoodBody
        dood={resolved === "error" ? { ...dood, eyes: "cross" } : dood}
        eyeColor={tokens.foreground}
        size={size}
        life={life}
        bodyStyle={bodyStyle}
      />
    );
  const avatar = (
    <View style={{ width: size, height: size }}>
      {picture}
      {parsed.kind !== "image" && clock !== "still" ? (
        <ThinkingDots color={DOOD_INK[dood.color].ink} size={size} life={life} />
      ) : null}
      {isWorking ? <WorkingDot size={size} muted={muted} /> : null}
      {muted ? <MutedBadge size={size} /> : null}
    </View>
  );
  // A tap is a little toy, not an action, so it stays out of the accessibility tree.
  return pokeable ? (
    <Pressable accessible={false} onPress={poke}>
      {avatar}
    </Pressable>
  ) : (
    avatar
  );
});

function WorkingDot({ size, muted }: { size: number; muted: boolean }) {
  const tokens = useMobileTokens();
  const { t } = useI18n();
  const dot = avatarWorkingDot(size);
  return (
    <View
      accessibilityLabel={t("Working")}
      style={{
        position: "absolute",
        right: muted ? undefined : dot.inset - dot.ring,
        left: muted ? dot.inset - dot.ring : undefined,
        bottom: dot.inset - dot.ring,
        width: dot.diameter + dot.ring * 2,
        height: dot.diameter + dot.ring * 2,
        borderRadius: size,
        borderWidth: dot.ring,
        borderColor: tokens.background,
        backgroundColor: tokens.workingDot,
      }}
    />
  );
}

function MutedBadge({ size }: { size: number }) {
  const tokens = useMobileTokens();
  const { t } = useI18n();
  return (
    <View
      accessible
      accessibilityLabel={t("Notifications silenced")}
      style={{
        position: "absolute",
        right: -2,
        bottom: -2,
        width: Math.max(14, Math.round(size * 0.34)),
        height: Math.max(14, Math.round(size * 0.34)),
        borderRadius: size,
        borderWidth: 2,
        borderColor: tokens.background,
        // Opaque under the translucent fill, so the avatar does not show through the bell.
        backgroundColor: tokens.background,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          borderRadius: size,
          backgroundColor: tokens.secondary,
        }}
      />
      <NativeSymbol
        ios="bell.slash.fill"
        android="notifications-off"
        size={Math.max(8, Math.round(size * 0.17))}
        color={tokens.foreground}
      />
    </View>
  );
}

/** The three typing dots a writing bot's avatar turns into; the middle one is its body. */
function ThinkingDots({ color, size, life }: { color: string; size: number; life: AvatarLife }) {
  return (
    <View pointerEvents="none" style={{ position: "absolute", width: size, height: size }}>
      <Dot slot={0} color={color} size={size} life={life} />
      <Dot slot={1} color={color} size={size} life={life} />
      <Dot slot={2} color={color} size={size} life={life} />
    </View>
  );
}

function Dot({
  slot,
  color,
  size,
  life,
}: {
  slot: 0 | 1 | 2;
  color: string;
  size: number;
  life: AvatarLife;
}) {
  const style = useAnimatedStyle(() => {
    const dot = avatarThinkingDot(slot, life.seconds.value, life.morph.value);
    const unit = size / AVATAR_MOTION_UNITS;
    const radius = dot.radius * unit;
    return {
      opacity: dot.opacity,
      width: radius * 2,
      height: radius * 2,
      borderRadius: radius,
      left: size / 2 + dot.x * unit - radius,
      top: size / 2 + dot.y * unit - radius,
    };
  });
  return <Animated.View style={[{ position: "absolute", backgroundColor: color }, style]} />;
}

type BodyStyle = ReturnType<typeof useAnimatedStyle>;

/** The eyes glance by the motion offsets and close about their centre line. */
function useDoodEyesStyle(life: AvatarLife, size: number) {
  return useAnimatedStyle(() => {
    const { x, y, lid, hidden } = eyeState(life);
    const unit = size / AVATAR_MOTION_UNITS;
    return {
      opacity: hidden ? 0 : 1,
      transform: [{ translateX: x * unit }, { translateY: y * unit }, { scaleY: lid }],
    };
  });
}

function DoodBody({
  dood,
  eyeColor,
  size,
  life,
  bodyStyle,
}: {
  dood: Dood;
  eyeColor: string;
  size: number;
  life: AvatarLife;
  bodyStyle: BodyStyle;
}) {
  const eyesStyle = useDoodEyesStyle(life, size);
  return (
    <Animated.View style={[{ width: size, height: size }, bodyStyle]}>
      <Svg width={size} height={size} viewBox={DOOD_VIEWBOX}>
        <Path
          d={DOOD_PATHS[dood.shape]}
          fill="none"
          stroke={DOOD_INK[dood.color].ink}
          strokeWidth={DOOD_STROKE_WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: "absolute",
            width: size,
            height: size,
            transformOrigin: `${(DOOD_EYE_ORIGIN.x / 24) * 100}% ${(DOOD_EYE_ORIGIN.y / 24) * 100}%`,
          },
          eyesStyle,
        ]}
      >
        <Svg width={size} height={size} viewBox={DOOD_VIEWBOX}>
          <G fill={eyeColor}>
            {doodEyeShapes(dood.eyes).map(({ d, rotate }, index) => (
              <Path
                key={index}
                d={d}
                transform={rotate ? `rotate(-45 ${rotate.cx} ${rotate.cy})` : undefined}
              />
            ))}
          </G>
        </Svg>
      </Animated.View>
    </Animated.View>
  );
}
