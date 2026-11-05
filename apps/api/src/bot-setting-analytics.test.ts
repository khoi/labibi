import { describe, expect, it } from "vitest";
import { changedBotSettings } from "./bot-setting-analytics.js";

const bot = {
  id: "bot-1",
  name: "Chief",
  instructions: "Be brief.",
  color: "#8B5CF6",
  notifyOnFinish: true,
  modelProvider: "anthropic",
  modelId: "claude",
  disabledBuiltinTools: ["web_search"],
};

describe("changedBotSettings", () => {
  it("ignores fields a save resends unchanged", () => {
    expect(
      changedBotSettings(bot, {
        botId: bot.id,
        name: "Chief",
        notifyOnFinish: true,
        disabledBuiltinTools: ["web_search"],
      }),
    ).toEqual([]);
  });

  it("names each changed setting once", () => {
    expect(
      changedBotSettings(bot, {
        botId: bot.id,
        instructions: "Be thorough.",
        notifyOnFinish: false,
        modelProvider: "openai",
        modelId: "gpt",
      }),
    ).toEqual(["instructions", "notifications", "model"]);
  });

  it("counts a provider change that keeps the model id", () => {
    expect(
      changedBotSettings(bot, { botId: bot.id, modelProvider: "openrouter", modelId: "claude" }),
    ).toEqual(["model"]);
  });
});
