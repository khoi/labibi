import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "./client.js";
import { findDefaultVoiceCredential, selectVoicePreference } from "./voice-credentials.js";

const account = { userId: "user" };
const credential = {
  id: "credential",
  userId: "user",
  provider: "elevenlabs",
  secretId: "secret",
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

function preferenceClient() {
  const table = () => ({
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    upsert: vi.fn().mockResolvedValue({ id: "preference" }),
    findFirst: vi.fn().mockResolvedValue(null),
  });
  const userVoicePreference = table();
  const prisma = {
    userVoicePreference,
    userVoiceCredential: { findFirst: vi.fn().mockResolvedValue(null) },
  } as unknown as PrismaClient;
  return { prisma, userVoicePreference };
}

describe("selectVoicePreference", () => {
  it("makes the account's connection the default", async () => {
    const { prisma, userVoicePreference } = preferenceClient();

    await selectVoicePreference(prisma, account, "credential", "voice");

    expect(userVoicePreference.updateMany).toHaveBeenCalledWith({
      where: { isDefault: true, credentialId: { not: "credential" }, userId: "user" },
      data: { isDefault: false },
    });
    expect(userVoicePreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_credentialId: { userId: "user", credentialId: "credential" } },
        create: expect.objectContaining({ userId: "user", voiceId: "voice", isDefault: true }),
      }),
    );
  });

  it("leaves the speech model unchanged when the caller omits it", async () => {
    const { prisma, userVoicePreference } = preferenceClient();

    await selectVoicePreference(prisma, account, "credential", "voice");

    const call = userVoicePreference.upsert.mock.calls[0]?.[0] as {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(call.create.speechModel).toBeUndefined();
    expect(call.update.speechModel).toBeUndefined();
  });

  it("stores or clears a speech model override with the voice", async () => {
    const { prisma, userVoicePreference } = preferenceClient();

    await selectVoicePreference(prisma, account, "credential", "voice", "s1");
    await selectVoicePreference(prisma, account, "credential", "voice", null);

    expect(userVoicePreference.upsert.mock.calls.map(([call]) => call.update)).toEqual([
      { voiceId: "voice", isDefault: true, speechModel: "s1" },
      { voiceId: "voice", isDefault: true, speechModel: null },
    ]);
  });
});

describe("voice that applies", () => {
  it("reads the account's default", async () => {
    const { prisma, userVoicePreference } = preferenceClient();
    userVoicePreference.findFirst.mockResolvedValue({
      credential,
      isDefault: true,
      voiceId: "account-voice",
      speechModel: null,
    });

    await expect(findDefaultVoiceCredential(prisma, account)).resolves.toMatchObject({
      id: "credential",
      voiceId: "account-voice",
      speechModel: "",
    });
  });
});
