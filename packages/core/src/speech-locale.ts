/** Speech recognizers need regional BCP-47 tags for the app's UI locale codes. */
const SPEECH_LOCALE_TAGS = {
  en: "en-US",
  de: "de-DE",
  es: "es-ES",
  fr: "fr-FR",
  he: "he-IL",
  hi: "hi-IN",
  ja: "ja-JP",
  ko: "ko-KR",
  nl: "nl-NL",
  pl: "pl-PL",
  "pt-BR": "pt-BR",
  ru: "ru-RU",
  tr: "tr-TR",
  "zh-CN": "zh-CN",
  "zh-TW": "zh-TW",
} as const;

/**
 * Recognizers name countries, not Latin America as a whole. Mexico's Spanish is the default
 * regional fallback for Latin American Spanish.
 */
const LATIN_AMERICAN_SPANISH = "es-MX";

export type SpeechLocale = keyof typeof SPEECH_LOCALE_TAGS;

export function speechLocaleTag(locale: SpeechLocale): string {
  return SPEECH_LOCALE_TAGS[locale];
}

/**
 * English UI follows the browser or device language, regardless of shipped catalogs.
 * Other UI languages use the speaker's region when the language matches; Chinese
 * keeps the app's tag to preserve its script. Known languages without a region use
 * the shared default for that language.
 */
export function recognitionLocaleTag(
  locale: SpeechLocale,
  speaker: string | null | undefined,
): string {
  const appTag = speechLocaleTag(locale);
  const normalized = speakerTag(speaker);
  const spoken = normalized === "es-419" ? LATIN_AMERICAN_SPANISH : normalized;
  if (!spoken || locale.startsWith("zh")) return appTag;
  const [language, region] = spoken.split("-");
  if (locale !== "en" && language !== appTag.split("-")[0]) return appTag;
  if (region) return spoken;
  return Object.values(SPEECH_LOCALE_TAGS).find((tag) => tag.startsWith(`${language}-`)) ?? spoken;
}

/** `es_ar`, `en-US-u-mu-celsius`, `zh-Hant-TW` → `es-AR`, `en-US`, `zh-TW`. */
function speakerTag(raw: string | null | undefined): string | null {
  const match = /^([a-z]{2,3})(?:-[a-z]{4})?(?:-([a-z]{2}|\d{3}))?(?:-|$)/i.exec(
    raw?.trim().replace(/_/g, "-") ?? "",
  );
  if (!match?.[1]) return null;
  const language = match[1].toLowerCase();
  const region = match[2]?.toUpperCase();
  return region ? `${language}-${region}` : language;
}
