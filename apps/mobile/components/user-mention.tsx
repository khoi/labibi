import { fontWeight, MAX_FONT_SCALE } from "@labradoodle/ui-tokens";
import { Text, useWindowDimensions, View } from "react-native";
import type { UserMentionTarget } from "../lib/message-mentions";
import { PersonAvatar } from "./chat-avatar";
import { DoodleAvatar } from "./doodle-avatar";

const AVATAR_SIZE = 15;
const AVATAR_GAP = 4;
/** An inline view sits on the baseline; this lowers it to centre on the capitals. */
const AVATAR_DROP = 3;

/** Doodle or a person named in a sent message: a small avatar and the name in medium weight. */
export function UserMention({ target, label }: { target: UserMentionTarget; label: string }) {
  const { fontScale } = useWindowDimensions();
  // Inline views do not follow Dynamic Type, so the avatar scales with the text up to the cap.
  const scale = Math.min(fontScale, MAX_FONT_SCALE);
  const size = AVATAR_SIZE * scale;
  return (
    <Text style={{ fontWeight: fontWeight.medium }}>
      <View
        style={{
          width: size + AVATAR_GAP * scale,
          height: size,
          transform: [{ translateY: AVATAR_DROP * scale }],
        }}
      >
        {target.kind === "doodle" ? (
          <DoodleAvatar size={size} />
        ) : (
          <PersonAvatar person={target} size={size} />
        )}
      </View>
      {label}
    </Text>
  );
}
