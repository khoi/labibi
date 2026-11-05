# Voice

Talk to your bots instead of typing, and have them read replies aloud.

## Set up a voice provider

Open **Settings → Voice**, pick a **Provider** and add its **API key**:

- **ElevenLabs**, **OpenAI** and **Fish Audio** can speak and transcribe.
- **Cartesia** speaks only.
- **Self-hosted** uses your own OpenAI-compatible speech server, such as Kokoro or Whisper. Enter its
  **Server URL**.
- **macOS** uses the voices installed on the Mac running your server, with no key. It appears only
  when the server runs on a Mac.

Then choose a **Voice**, and use **Hear a sample** to check it. **Speech model** and
**Transcription model** let you pick the provider's models.

Voice settings apply to every [space](./spaces.md).

## Talk instead of typing

Hold the microphone in the composer and speak; release to send. Slide up to lock recording so you
don't have to keep holding.

## Hear replies

- To hear one reply, choose **Speak this reply** on the message.
- To hear every reply from a bot, open its settings, expand **Advanced**, and turn on
  **Read replies aloud**. The **Voice** next to it overrides your default voice for that bot.

## On mobile

The mobile app can use your phone's own voices. Pick a **Device voice** in a bot's settings.
