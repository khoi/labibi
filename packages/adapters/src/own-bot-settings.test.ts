import { VoiceAccountError } from "@labradoodle/adapter-kit";
import type { PrismaClient } from "@labradoodle/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ModelSelection from "./model-selection.js";
import { validateBotModelChange } from "./model-selection.js";
import type { BotSettingsDeps } from "./own-bot-settings.js";
import {
  prepareOwnBotSettings,
  readOwnBotSettings,
  resolveVoiceChoice,
} from "./own-bot-settings.js";

vi.mock("./model-selection.js", async (importOriginal) => ({
  ...(await importOriginal<typeof ModelSelection>()),
  validateBotModelChange: vi.fn(),
}));

const validate = vi.mocked(validateBotModelChange);
const scope = { userId: "user-1", spaceId: "space-1" };

function deps(): BotSettingsDeps {
  const credential = {
    id: "cred-google",
    provider: "google",
    secretId: "secret-google",
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
  const prisma = {
    userModelCredential: { findMany: vi.fn(async () => [credential]) },
    userModelPreference: { findMany: vi.fn(async () => []) },
    secret: { findMany: vi.fn(async () => [{ id: "secret-google", ciphertext: "fake" }]) },
  };
  return {
    prisma: prisma as unknown as PrismaClient,
    modelChange: {
      secretStore: { load: async () => "fake-api-key" },
      refreshExpiredCredential: vi.fn(),
      defaultModel: async () => ({ provider: "google", model: "gemini-3.8-flash" }),
    },
  };
}

const bot = {
  name: "Scout",
  instructions: "Cite sources.",
  notifyOnFinish: true,
  modelProvider: null,
  modelId: null,
  thinkingLevel: null,
  autoSpeak: false,
  voiceId: null,
};

beforeEach(() => {
  validate.mockReset();
  validate.mockImplementation(async (_deps, input) => ({
    ok: true,
    provider: input.provider,
    model: input.model,
    thinkingLevel: input.thinkingLevel ?? null,
  }));
});

/** A settings read that must succeed. */
async function readSettings(bot: Parameters<typeof readOwnBotSettings>[2], offset?: number) {
  const settings = await readOwnBotSettings(deps(), scope, bot, offset);
  if ("error" in settings) throw new Error(settings.error);
  return settings;
}

describe("readOwnBotSettings", () => {
  it("pages long instructions, naming the window and the next offset", async () => {
    const long = { ...bot, instructions: "x".repeat(19_000) };
    const first = await readSettings(long);
    const second = await readSettings(long, 8_000);
    const last = await readSettings(long, 16_000);
    expect(first.instructions).toBe("x".repeat(8_000));
    expect(first.instructionsLength).toBe(19_000);
    expect(first.instructionsOffset).toBe(0);
    expect(first.instructionsNextOffset).toBe(8_000);
    expect(second.instructionsOffset).toBe(8_000);
    expect(second.instructionsNextOffset).toBe(16_000);
    expect(last.instructions).toBe("x".repeat(3_000));
    expect(last.instructionsNextOffset).toBeNull();
    expect([first, second, last].map((page) => page.instructions).join("")).toBe(long.instructions);
    for (const page of [first, second, last]) {
      expect(JSON.stringify(page).length).toBeLessThan(12_000);
    }
  });

  it("shrinks pages until the whole serialized result fits, whole characters only", async () => {
    const long = {
      ...bot,
      instructions: 'x"\n\\😀'.repeat(3_300),
    };
    type Page = Awaited<ReturnType<typeof readSettings>>;
    const pages: Page[] = [];
    let offset = 0;
    for (;;) {
      const page = await readSettings(long, offset);
      pages.push(page);
      expect(JSON.stringify(page).length).toBeLessThanOrEqual(10_000);
      const last = page.instructions!.charCodeAt(page.instructions!.length - 1);
      expect(last < 0xd800 || last > 0xdbff).toBe(true);
      const next = page.instructionsNextOffset;
      if (next === null || next === undefined) break;
      offset = next;
    }
    expect(pages.length).toBeGreaterThan(2);
    expect(pages.map((page) => page.instructions).join("")).toBe(long.instructions);
  });

  it("pages short instructions when escaping overflows the result", async () => {
    const heavy = { ...bot, instructions: '"\n'.repeat(2_500) };
    let text = "";
    let offset: number | null | undefined = 0;
    while (typeof offset === "number") {
      const page = await readSettings(heavy, offset);
      expect(JSON.stringify(page).length).toBeLessThanOrEqual(10_000);
      expect(page.instructionsLength).toBe(5_000);
      text += page.instructions;
      offset = page.instructionsNextOffset;
    }
    expect(text).toBe(heavy.instructions);
  });

  it("returns longer instructions whole while the result still fits", async () => {
    const mid = { ...bot, instructions: "x".repeat(9_000) };
    const settings = await readSettings(mid);
    expect(settings.instructions).toBe(mid.instructions);
    expect(settings).not.toHaveProperty("instructionsLength");
  });

  it("keeps short instructions in one page with no paging fields", async () => {
    const settings = await readSettings(bot, 5);
    expect(settings.instructions).toBe("Cite sources.");
    expect(settings).not.toHaveProperty("instructionsLength");
    expect(settings).not.toHaveProperty("instructionsOffset");
    expect(settings).not.toHaveProperty("instructionsNextOffset");
  });
});

describe("prepareOwnBotSettings", () => {
  it("resolves a loose model name and keeps a thinking level the new model supports", async () => {
    const result = await prepareOwnBotSettings(
      deps(),
      scope,
      { modelProvider: "google", modelId: "gemini-3.7-flash", thinkingLevel: "high" },
      { model: "Gemini Flash" },
    );
    expect(result).toEqual({
      data: { modelProvider: "google", modelId: "gemini-3.8-flash", thinkingLevel: "high" },
    });
    expect(validate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        provider: "google",
        model: "gemini-3.8-flash",
        thinkingLevel: "high",
        current: { provider: "google", model: "gemini-3.7-flash" },
      }),
    );
  });

  it("falls back to the new model's default level when the current one is unsupported", async () => {
    validate.mockImplementationOnce(async () => ({ ok: false, error: "Unsupported" }));
    const result = await prepareOwnBotSettings(
      deps(),
      scope,
      { modelProvider: null, modelId: null, thinkingLevel: "xhigh" },
      { model: "gemini-3.8-flash" },
    );
    expect(result).toEqual({
      data: { modelProvider: "google", modelId: "gemini-3.8-flash", thinkingLevel: null },
    });
  });

  it("returns the settings check's refusal for a level the user asked for", async () => {
    validate.mockImplementation(async () => ({
      ok: false,
      error: "Thinking level must be one of: low, medium, high",
    }));
    expect(await prepareOwnBotSettings(deps(), scope, bot, { thinkingLevel: "minimal" })).toEqual({
      error: "Thinking level must be one of: low, medium, high",
    });
    expect(validate).toHaveBeenCalledOnce();
  });

  it("refuses values outside the allowed ones before any check", async () => {
    expect(await prepareOwnBotSettings(deps(), scope, bot, { thinkingLevel: "turbo" })).toEqual({
      error: expect.stringContaining("thinkingLevel must be one of"),
    });
    expect(validate).not.toHaveBeenCalled();
  });

  it("says which provider to connect for a model it cannot run", async () => {
    expect(await prepareOwnBotSettings(deps(), scope, bot, { model: "Claude Sonnet" })).toEqual({
      error: expect.stringContaining("Anthropic"),
    });
    expect(validate).not.toHaveBeenCalled();
  });
});

const voices = [
  { id: "voice-rachel", label: "Rachel" },
  { id: "voice-adam", label: "Adam - Deep Narrator" },
  { id: "voice-adam-2", label: "Adam - Calm" },
  { id: "voice-sumire", label: "菫 清楚" },
];

describe("resolveVoiceChoice", () => {
  it.each([
    ["rachel", "voice-rachel"],
    ["voice-rachel", "voice-rachel"],
    ["Deep narrator", "voice-adam"],
    ["菫", "voice-sumire"],
    ["default", null],
  ])("resolves %s", (query, voiceId) => {
    expect(resolveVoiceChoice(voices, query)).toEqual({ ok: true, voiceId });
  });

  it("asks which one when several match, and lists voices when none do", () => {
    expect(resolveVoiceChoice(voices, "Adam")).toEqual({
      ok: false,
      error: expect.stringContaining("Adam - Deep Narrator, Adam - Calm"),
    });
    expect(resolveVoiceChoice(voices, "Bella")).toEqual({
      ok: false,
      error:
        'No voice matches "Bella". Voices: Rachel, Adam - Deep Narrator, Adam - Calm, 菫 清楚.',
    });
  });

  it("bounds the echoed query in errors", () => {
    const huge = "b".repeat(60_000);
    const result = resolveVoiceChoice(voices, huge);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeLessThan(500);
  });
});

describe("prepareOwnBotSettings voice", () => {
  it("returns an error the bot can act on when listing voices fails", async () => {
    const failing = async () => {
      throw new Error("provider timeout");
    };
    expect(await prepareOwnBotSettings(deps(), scope, bot, { voice: "Rachel" }, failing)).toEqual({
      error: "Could not list voices right now; try again.",
    });
    const refused = async () => {
      throw new VoiceAccountError(undefined, "The voice provider rejected the API key.");
    };
    expect(await prepareOwnBotSettings(deps(), scope, bot, { voice: "Rachel" }, refused)).toEqual({
      error: "The voice provider rejected the API key.",
    });
  });

  it("resets to the default voice without a voice provider", async () => {
    expect(
      await prepareOwnBotSettings(deps(), scope, bot, { voice: "default" }, async () => null),
    ).toEqual({ data: { voiceId: null } });
  });

  it("lists voices only when a voice is asked for and stores the match", async () => {
    const list = vi.fn(async () => voices);
    expect(await prepareOwnBotSettings(deps(), scope, bot, { voice: "Rachel" }, list)).toEqual({
      data: { voiceId: "voice-rachel" },
    });
  });

  it("asks for a voice connection when there is none", async () => {
    expect(
      await prepareOwnBotSettings(deps(), scope, bot, { voice: "Rachel" }, async () => null),
    ).toEqual({ error: "Connect a voice provider first." });
  });
});
