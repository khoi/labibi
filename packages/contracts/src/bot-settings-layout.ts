/** Shared section membership and order; surfaces omit unavailable capabilities. */
export const BOT_SETTINGS_SECTIONS = {
  memory: ["knowledge"],
  advanced: [
    "model",
    "thinking",
    "voice",
    "instructions",
    "disabledTools",
    "credentials",
    "skills",
    "clear",
  ],
} as const;

export const BOT_SETTINGS_ADVANCED_ORDER = BOT_SETTINGS_SECTIONS.advanced;
