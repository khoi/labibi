import * as z from "zod";

export const Id = z.string().min(1);
export const IsoDate = z.string().datetime({ offset: true });

export const ActorSchema = z.object({
  userId: Id,
  spaceId: Id,
  email: z.string().email(),
  /** Deprecated wire field. App accounts have no deployment role; always false. */
  isDeploymentOwner: z.boolean(),
});
export type Actor = z.infer<typeof ActorSchema>;

/** The seven dood inks; a new bot wears the least-used one. */
export const BOT_COLORS = [
  "#FFBC0A",
  "#1E98F5",
  "#ED6095",
  "#FE6F02",
  "#4FAA52",
  "#FAB5E3",
  "#9D9C9B",
] as const;

export const RunStatus = z.enum([
  "queued",
  "leased",
  "running",
  "waiting_input",
  "waiting_takeover",
  "completed",
  "failed",
  "cancelled",
]);
export type RunStatus = z.infer<typeof RunStatus>;

export const EffectStatus = z.enum(["intended", "completed", "failed", "ambiguous", "reconciled"]);
export type EffectStatus = z.infer<typeof EffectStatus>;

export const ThinkingLevelSchema = z.enum([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
export type ThinkingLevel = z.infer<typeof ThinkingLevelSchema>;

export const MemoryScope = z.enum(["chat", "person"]);
export type MemoryScope = z.infer<typeof MemoryScope>;

export const SandboxKind = z.enum([
  "none",
  "docker",
  "e2b",
  "novita",
  "daytona",
  "createos",
  "boat",
  "boxd",
  "railway",
  "kubernetes",
  "incus",
  "wuying",
  "desktop",
  "fake",
]);
export type SandboxKind = z.infer<typeof SandboxKind>;
