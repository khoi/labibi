import type { PrismaClient } from "./client.js";
import { newestCredentialOrder } from "./model-credentials.js";

export const newestVoiceCredentialOrder = newestCredentialOrder;

/** Whose voice choices: a member's are theirs in every Space. */
type VoiceOwner = { userId: string };

type VoicePreferenceClient = Pick<PrismaClient, "userVoicePreference">;
type VoiceReadClient = VoicePreferenceClient & Pick<PrismaClient, "userVoiceCredential">;

type PreferenceFilter = { isDefault?: boolean; credential?: { provider: string } };

function findPreferenceWithCredential(
  prisma: VoicePreferenceClient,
  owner: VoiceOwner,
  where: PreferenceFilter,
) {
  return prisma.userVoicePreference.findFirst({
    where: { ...where, userId: owner.userId },
    include: { credential: true },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }, { credentialId: "desc" }],
  });
}

export function listVoicePreferences(prisma: VoicePreferenceClient, owner: VoiceOwner) {
  return prisma.userVoicePreference.findMany({
    where: { userId: owner.userId },
    include: { credential: true },
  });
}

export function findVoicePreference(
  prisma: VoicePreferenceClient,
  owner: VoiceOwner,
  credentialId: string,
) {
  return prisma.userVoicePreference.findUnique({
    where: { userId_credentialId: { userId: owner.userId, credentialId } },
  });
}

/**
 * Saves a connection's choice; omitted fields keep what is saved. `isDefault` also takes the
 * default from the member's other connections, so speak and transcribe use it.
 */
export async function saveVoicePreference(
  prisma: VoicePreferenceClient,
  owner: VoiceOwner,
  credentialId: string,
  data: { voiceId?: string; speechModel?: string | null; isDefault?: true },
) {
  if (data.isDefault) {
    await prisma.userVoicePreference.updateMany({
      where: { isDefault: true, credentialId: { not: credentialId }, userId: owner.userId },
      data: { isDefault: false },
    });
  }
  return prisma.userVoicePreference.upsert({
    where: { userId_credentialId: { userId: owner.userId, credentialId } },
    create: { userId: owner.userId, credentialId, ...data },
    update: data,
  });
}

/** Makes a connection and voice the default. Omitted speechModel keeps the saved one. */
export function selectVoicePreference(
  prisma: VoicePreferenceClient,
  owner: VoiceOwner,
  credentialId: string,
  voiceId: string,
  speechModel?: string | null,
) {
  return saveVoicePreference(prisma, owner, credentialId, {
    voiceId,
    speechModel,
    isDefault: true,
  });
}

function withVoicePreference<
  T extends {
    credential: {
      id: string;
      userId: string;
      provider: string;
      secretId: string;
      createdAt: Date;
      updatedAt: Date;
    };
    isDefault: boolean;
    voiceId: string;
    speechModel: string | null;
  },
>(preference: T) {
  return {
    ...preference.credential,
    isDefault: preference.isDefault,
    voiceId: preference.voiceId,
    speechModel: preference.speechModel ?? "",
  };
}

/** The member's default voice connection. */
export async function findDefaultVoiceCredential(prisma: VoiceReadClient, owner: VoiceOwner) {
  const preference = await findPreferenceWithCredential(prisma, owner, { isDefault: true });
  return preference ? withVoicePreference(preference) : null;
}

export function findNewestUserVoiceCredential(
  prisma: Pick<PrismaClient, "userVoiceCredential">,
  userId: string,
  provider: string,
) {
  return prisma.userVoiceCredential.findFirst({
    where: { userId, provider },
    orderBy: newestVoiceCredentialOrder,
  });
}

/** A provider's connection with the member's choice for it. */
export async function findVoiceCredential(
  prisma: VoiceReadClient,
  owner: VoiceOwner,
  provider: string,
) {
  const preference = await findPreferenceWithCredential(prisma, owner, {
    credential: { provider },
  });
  if (preference) return withVoicePreference(preference);
  const credential = await findNewestUserVoiceCredential(prisma, owner.userId, provider);
  return credential ? { ...credential, isDefault: false, voiceId: "", speechModel: "" } : null;
}
