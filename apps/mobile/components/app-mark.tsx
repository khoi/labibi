import {
  DOOD_INK,
  DOOD_PATHS,
  DOOD_STROKE_WIDTH,
  DOOD_VIEWBOX,
  doodEyeShapes,
} from "@labradoodle/core";
import { View } from "react-native";
import Svg, { G, Path } from "react-native-svg";
import { useMobileTokens } from "../lib/native";

const MARK = 56;

/** Doodle, the dood every bot starts as, signing off the bottom of Settings. */
export function AppMark() {
  const tokens = useMobileTokens();
  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ alignSelf: "center" }}
    >
      <Svg width={MARK} height={MARK} viewBox={DOOD_VIEWBOX}>
        <Path
          d={DOOD_PATHS.coil}
          fill="none"
          stroke={DOOD_INK.yellow.ink}
          strokeWidth={DOOD_STROKE_WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <G fill={tokens.foreground}>
          {doodEyeShapes("round").map(({ d }) => (
            <Path key={d} d={d} />
          ))}
        </G>
      </Svg>
    </View>
  );
}
