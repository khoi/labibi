import type { VoiceProvider } from "./types";
import { GITHUB_URL } from "../site";
import { VOICE_DOC, VOICE_MODELS_DOC, voicePriceTable, withPricingSources } from "./shared";

const COMPARED = ["macos", "selfHosted", "openai", "fish", "elevenlabs", "cartesia"] as const;

export const macos: VoiceProvider = {
  slug: "macos",
  name: "macOS voices",
  does: "Speaks only",
  runs: "Your Mac",
  bestFor: "Running Labradoodle on a Mac with no voice key",
  title: "macOS text to speech for AI agents: the built-in Mac voices, free and with no API key",
  description:
    "How macOS text to speech works, from Read & Speak to the say command and Premium voices, and how Labradoodle uses the Mac's built-in voices so AI agents can read replies aloud for free. Compared with paid voice APIs, with limits and setup.",
  h1: "macOS text to speech for AI agents: use your Mac's built-in voices",
  intro: [
    "Every Mac ships with dozens of text-to-speech voices, and Apple offers Enhanced and Premium versions that sound more natural. The `say` command turns text into speech with any of them, entirely on the machine, with no account and no API key.",
    "[Labradoodle](/) is an open source app for AI teammates that do real work. You talk to each bot in chat, and you can also talk to it by voice: hold the mic to speak or have replies read aloud. When the Labradoodle server runs directly on a Mac, it offers **Server (Mac)** as a voice provider, so bots speak with that Mac's voices and no voice vendor.",
  ],
  scene: {
    bot: "Chief of Staff",
    color: "#4FAA52",
    where: "Voice from the server's Mac",
    ask: "read me today's summary",
    reply: "two things need you. the rest is handled.",
    results: [
      { k: "Voice", v: "Zoe (Premium), built into macOS" },
      { k: "Key", v: "None needed" },
      { k: "Read aloud", v: "every reply, on your phone or laptop" },
    ],
  },
  sections: [
    {
      heading: "What are macOS voices?",
      paragraphs: [
        "They are the system voices macOS uses for its own spoken content, such as reading selected text aloud. The `/usr/bin/say` command speaks with any installed voice and can save the result to an audio file instead of playing it, which is what Labradoodle does.",
        "Voices come in three tiers: Compact, which is small and robotic; Enhanced; and Premium, the most natural, available for a handful of voices such as Ava and Zoe in US English and Jamie and Serena in British English. Siri's voices aren't available to `say`. Personal Voice, the voice you can record of yourself, is only available to apps you grant permission to.",
      ],
      image: true,
    },
    {
      heading: "How to use text to speech on a Mac",
      paragraphs: [
        "In macOS 26 and later, Apple renamed the **Spoken Content** settings to **Read & Speak**. That's where you pick the system voice and download better ones; older guides still use the old name.",
      ],
      steps: [
        "Open **System Settings → Accessibility → Read & Speak**. On macOS 15 and earlier, it's **Accessibility → Spoken Content**.",
        "Choose a voice from the **System voice** menu. To get Enhanced or Premium voices, click the Info button next to it, pick a language, and click a voice to download it.",
        "Turn on **Speak selection** to have the Mac read any selected text with a keyboard shortcut, Option-Esc by default.",
        "In Terminal, `say -v '?'` lists installed voices, `say -v 'Zoe (Premium)' \"hello\"` speaks, and `say -o hello.aiff \"hello\"` saves the audio to a file.",
      ],
    },
    {
      heading: "What it costs",
      paragraphs: [
        "Nothing. The voices come with macOS, run on the Mac's own processor, and have no usage limit. That's the whole case for them: a bot that reads replies all day costs the same as one that never speaks. The trade-off is quality, since even Premium voices sound less natural than the best hosted ones, and there's no transcription.",
      ],
      table: voicePriceTable("macOS voices compared with paid voice APIs", COMPARED),
    },
    {
      heading: "What you can do with macOS voices in Labradoodle",
      paragraphs: [
        "The server renders each reply into a short audio clip with `say` and sends it to whoever is listening, so it plays on your phone or laptop like any other voice, not out of the server's speakers. The [voice guide](/docs/voice-and-calls/) covers each feature.",
      ],
      bullets: [
        "Hear replies. Choose **Speak this reply** on a message, or turn on **Read replies aloud** in a bot's settings.",
        "Talk instead of typing, using on-device speech recognition. macOS voices don't transcribe, so your words are recognized by your browser, such as Chrome, or by the Labradoodle desktop app on a Mac.",
        "Choose any installed voice, and a different one for each bot. Premium and Enhanced voices are listed first.",
      ],
    },
    {
      heading: "When to choose macOS voices",
      paragraphs: [
        "Choose them when you run Labradoodle on your own Mac and want bots to speak right away, with nothing to sign up for, nothing to install and nothing to pay. Speech is made on the machine running Labradoodle, with no vendor involved, then sent to whichever device is listening.",
        "For voices that also transcribe, a [self-hosted speech server](/voice-providers/self-hosted/) keeps everything on your own hardware and works on Linux too; on a Mac, mlx-audio runs Kokoro and Whisper quickly. Hosted providers sound more natural and need a key: [ElevenLabs](/voice-providers/elevenlabs/) and [Fish Audio](/voice-providers/fish-audio/) clone voices, [OpenAI](/voice-providers/openai/) is the simplest, and [Cartesia](/voice-providers/cartesia/) is built for low latency. The [voice provider comparison](/voice-providers/) shows all six.",
      ],
    },
    {
      heading: "Limits",
      bullets: [
        "Labradoodle only offers **Server (Mac)** when its server process runs directly on macOS. A server in Docker, including Docker Desktop on a Mac and the desktop app's **This computer** install, runs Linux inside the container, so the option doesn't appear. Linux hosts don't list it either.",
        "It doesn't transcribe. Hold-to-talk depends on speech recognition in your browser or the desktop app, and voice notes from messaging apps reach bots without a transcript.",
        "macOS voices sound less natural than the best hosted voices, and there's no voice cloning.",
        "The voices are whatever is installed on the server's Mac. A newly downloaded voice can take a few minutes to show up.",
        "Labradoodle lists the voices `say -v '?'` reports. We haven't tested Personal Voice, which needs the server process to be granted permission.",
        "On the mobile app, a bot can speak with your phone's own voices if you pick a **Device voice** in its settings. Otherwise replies use this provider.",
      ],
    },
    {
      heading: "How to set it up",
      paragraphs: [
        "This is for someone running Labradoodle from source on their own Mac. The [self-hosting guide](/docs/self-host/) has the full instructions.",
      ],
      steps: [
        "On the Mac, clone Labradoodle, copy `.env.example` to `.env`, then run `pnpm install`, `pnpm sandbox:build` and `pnpm dev`. This runs the Labradoodle API directly on macOS.",
        "Optionally download Enhanced or Premium voices under **System Settings → Accessibility → Read & Speak**, with the Info button next to **System voice**.",
        "In Labradoodle, open **Settings → Voice** and set **Provider** to **Server (Mac)**. There's no key to enter.",
        "Pick a **Voice** and choose **Hear a sample**.",
      ],
    },
  ],
  image: {
    webp: "/graphics/grok/chat.webp",
    avif: "/graphics/grok/chat.avif",
    width: 1200,
    height: 800,
    alt: "Labradoodle with the bot Inbox replying in chat, beside a list of bots.",
    caption: "A bot's chat in Labradoodle. With macOS voices, replies you hear are spoken by the server's Mac.",
  },
  faq: [
    {
      question: "Does macOS have text to speech?",
      answer:
        "Yes. Turn on **Speak selection** under **System Settings → Accessibility → Read & Speak** (Spoken Content before macOS 26) to have any selected text read aloud, or use the `say` command in Terminal. It's free and works offline.",
    },
    {
      question: "Can an AI assistant use the macOS say command?",
      answer:
        "Yes. When Labradoodle's server runs on a Mac, it uses `say` to turn each reply into an audio clip in the voice you pick, with no API key.",
    },
    {
      question: "Why don't I see Server (Mac) in Labradoodle?",
      answer:
        "The option only appears when the Labradoodle server runs directly on macOS. In Docker, even on a Mac, the server runs on Linux and can't reach `say`. Use a self-hosted speech server there instead.",
    },
    {
      question: "Can macOS voices transcribe what I say?",
      answer:
        "No, they only speak. Labradoodle uses on-device speech recognition from your browser or the desktop app for your side, or you can switch to a provider that transcribes.",
    },
    {
      question: "How do I get better macOS voices?",
      answer:
        "Download Enhanced or Premium voices on the server's Mac: in **System Settings → Accessibility → Read & Speak**, click the Info button next to **System voice**, pick a language and click a voice. Labradoodle lists them first.",
    },
    {
      question: "Are macOS voices as good as ElevenLabs?",
      answer:
        "No. Premium voices are clear and pleasant, but hosted voices from [ElevenLabs](/voice-providers/elevenlabs/) or [Fish Audio](/voice-providers/fish-audio/) sound noticeably more human. macOS voices are free and private, which is why they're worth trying first.",
    },
  ],
  sources: withPricingSources(
    [
    {
      label: "Apple, change the voice your Mac uses to speak text",
      href: "https://support.apple.com/guide/mac-help/mchlp2290/mac",
    },
    { label: "ss64, the say command", href: "https://ss64.com/mac/say.html" },
    VOICE_DOC,
    VOICE_MODELS_DOC,
    { label: "Labradoodle, self-hosting", href: `${GITHUB_URL}/blob/main/docs/self-host.md` },
    ],
    { prices: COMPARED },
  ),
};
