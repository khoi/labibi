import { MAX_FONT_SCALE, typeScale } from "@labradoodle/ui-tokens";
import { useEffect, useState } from "react";
import { Text } from "react-native";
import Animated, {
  Easing,
  FadeOut,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useMobileTokens } from "../lib/native";
import { DoodleAvatar } from "./doodle-avatar";

/** The mark is Doodle's 28 pt avatar. */
export const MARK_SIZE = 28;
/** The mark row's height, with room for a tap's hop, and how long it takes to open. */
export const ROW_HEIGHT = 40;
export const ROW_MS = 260;
/** The row opens quickly and slows into place. */
const ROW_EASING = Easing.out(Easing.cubic);
/** The spring the mark grows in with, once the row is open: a small, friendly overshoot. */
export const MARK_SPRING = { duration: 480, dampingRatio: 0.6 } as const;

/**
 * Doodle at the end of a chat while it works: its avatar moves (or turns into the typing dots
 * while it writes) and plays a little reaction when tapped. It grows in once the chat is
 * scrolled to the newest message. `label` says what it is doing beside it.
 */
export function ActivityMark({
  identity,
  status,
  composing,
  atBottom,
  label,
}: {
  /** The chat Doodle works in. */
  identity: string;
  status?: string;
  composing: boolean;
  atBottom: boolean;
  label?: string;
}) {
  const tokens = useMobileTokens();
  const reducedMotion = useReducedMotion();
  const height = useSharedValue(reducedMotion ? ROW_HEIGHT : 0);
  const scale = useSharedValue(reducedMotion ? 1 : 0);
  const [arrived, setArrived] = useState(reducedMotion);

  useEffect(() => {
    height.value = withTiming(ROW_HEIGHT, { duration: ROW_MS, easing: ROW_EASING });
  }, [height]);
  useEffect(() => {
    if (arrived || !atBottom) return;
    setArrived(true);
    scale.value = withSpring(1, MARK_SPRING);
  }, [arrived, atBottom, scale]);

  const rowStyle = useAnimatedStyle(() => ({ height: height.value }));
  const markStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Animated.View
      exiting={reducedMotion ? undefined : FadeOut.duration(ROW_MS)}
      style={[{ flexDirection: "row", alignItems: "center", gap: 8, overflow: "hidden" }, rowStyle]}
    >
      <Animated.View style={[{ width: MARK_SIZE, height: MARK_SIZE }, markStyle]}>
        <DoodleAvatar
          identity={identity}
          size={MARK_SIZE}
          status={status}
          motion="running"
          composing={composing}
          pokeable
        />
      </Animated.View>
      {label ? (
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={{ flexShrink: 1, color: tokens.mutedForeground, ...typeScale.secondary }}
        >
          {label}
        </Text>
      ) : null}
    </Animated.View>
  );
}
