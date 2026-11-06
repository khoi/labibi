import * as z from "zod";

export const AI_DISCLOSURE_VERSION = "2026-09-14";
export const AI_PRIVACY_URL = "https://labradoodle.com/privacy/";
export const AiDataUseSchema = z.enum(["model", "voice", "memory"]);
export type AiDataUse = z.infer<typeof AiDataUseSchema>;
export const AI_DATA_DISCLOSURES: Record<AiDataUse, string> = {
  model:
    "Messages, chat history, Doodle's instructions, memories, attachments, screenshots and connected-app content are sent to run Doodle, including routines.",
  voice:
    "Your recordings are sent for transcription, and text you play is sent to generate speech.",
  memory:
    "Conversation summaries, memories, searches and chat and person IDs are sent to store and recall context.",
};
export const AiConsentQuerySchema = z
  .object({
    /** A chat: only its routines count beside Doodle. */
    threadId: z.string().optional(),
    routineId: z.string().optional(),
    uses: z.array(AiDataUseSchema).optional(),
  })
  .default({});
export type AiConsentQuery = z.infer<typeof AiConsentQuerySchema>;
export const AiRecipientSchema = z.object({
  key: z.string(),
  name: z.string(),
  use: AiDataUseSchema,
  detail: z.string(),
  privacyUrl: z.string().url().optional(),
  allowed: z.boolean(),
});
export type AiRecipient = z.infer<typeof AiRecipientSchema>;
export const AiConsentStatusSchema = z.object({
  scope: z.string(),
  version: z.string(),
  recipients: z.array(AiRecipientSchema),
  privacyUrl: z.string().url().optional(),
});
export type AiConsentStatus = z.infer<typeof AiConsentStatusSchema>;
export const AI_CONSENT_REQUIRED = "Review AI data sharing in Account settings before continuing.";
