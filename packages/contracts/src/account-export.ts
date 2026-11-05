import * as z from "zod";
import { Id, IsoDate } from "./ids.js";
import { PageSourceSchema, PageTitleSchema } from "./pages.js";

/**
 * A whole account as one zip, to move between Labradoodle installs (Cloud to self-hosted and back).
 *
 * - `manifest.json` comes first: the format, version and the exported spaces.
 * - `spaces/<spaceId>/records.jsonl`: one `AccountExportRecord` per line. A record only refers to
 *   records earlier in the same file.
 * - `spaces/<spaceId>/artifacts/<artifactId>`: each artifact's bytes, after the records.
 * - `spaces/<spaceId>/home/<path>`: the files of the person's computer there, after the records.
 * - `spaces/<spaceId>/executables.json`: after the workspace files, which of them are executable
 *   (a streamed zip cannot carry file modes back out). Left out when none are.
 *
 * Content is decrypted. Ids are the source install's; an import gives every row a new id and
 * rewrites references, including ids inside message blocks. Every chat the person is in is
 * exported with everyone's messages; an import makes each one a chat with only that person.
 * Credentials, integrations, runs, billing, computers and page links are not exported: they
 * belong to the source install.
 */
/** A page version number, within the database's 32-bit column. */
const PageVersionNumber = z.number().int().positive().max(2_147_483_647);

export const ACCOUNT_EXPORT_FORMAT = "rakazo-account-export";
export const ACCOUNT_EXPORT_VERSION = 2;
export const ACCOUNT_EXPORT_MANIFEST_PATH = "manifest.json";
/** Larger workspace files stay behind, matching the workspace export limit elsewhere. */
export const ACCOUNT_EXPORT_MAX_HOME_FILE_BYTES = 8 * 1024 * 1024;

export const accountExportPaths = {
  records: (spaceId: string) => `spaces/${spaceId}/records.jsonl`,
  artifact: (spaceId: string, artifactId: string) => `spaces/${spaceId}/artifacts/${artifactId}`,
  homeFile: (spaceId: string, path: string) => `spaces/${spaceId}/home/${path}`,
  executables: (spaceId: string) => `spaces/${spaceId}/executables.json`,
};

export const AccountExportExecutablesSchema = z.array(z.object({ path: z.string() }));
export type AccountExportExecutables = z.infer<typeof AccountExportExecutablesSchema>;

export const AccountExportManifestSchema = z.object({
  format: z.literal(ACCOUNT_EXPORT_FORMAT),
  version: z.literal(ACCOUNT_EXPORT_VERSION),
  exportedAt: IsoDate,
  user: z.object({ name: z.string(), email: z.string(), timezone: z.string().nullable() }),
  spaces: z.array(z.object({ id: Id, name: z.string(), createdAt: IsoDate })),
});
export type AccountExportManifest = z.infer<typeof AccountExportManifestSchema>;

const json = z.json();

export const AccountExportRecordSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("thread"),
    id: Id,
    name: z.string().nullable(),
    doodle: z.boolean(),
    historyCompactedUpToSeq: z.number().int().nullable(),
    historyCompactionSummary: z.string().nullable(),
    createdAt: IsoDate,
  }),
  z.object({
    type: z.literal("message"),
    id: Id,
    threadId: Id,
    seq: z.number().int(),
    role: z.string(),
    blocks: json,
    replyToMessageId: Id.nullable(),
    replyQuote: z.string().nullable(),
    createdAt: IsoDate,
  }),
  /** A page arrives private: its link stays with the source install. */
  z.object({
    type: z.literal("page"),
    id: Id,
    threadId: Id,
    title: PageTitleSchema,
    pinnedAt: IsoDate.nullable(),
    currentVersion: PageVersionNumber,
    createdAt: IsoDate,
    updatedAt: IsoDate,
  }),
  z.object({
    type: z.literal("page_version"),
    id: Id,
    pageId: Id,
    version: PageVersionNumber,
    title: PageTitleSchema,
    source: PageSourceSchema,
    createdAt: IsoDate,
  }),
  z.object({
    type: z.literal("artifact"),
    id: Id,
    threadId: Id,
    name: z.string(),
    description: z.string().nullable(),
    mimeType: z.string(),
    size: z.number().int().nonnegative(),
    hash: z.string(),
    rootArtifactId: Id.nullable(),
    version: z.number().int().positive(),
    createdAt: IsoDate,
  }),
  z.object({
    type: z.literal("memory_document"),
    id: Id,
    /** Null for the person's own memory in the workspace. */
    threadId: Id.nullable(),
    path: z.string(),
    content: z.string(),
    revision: z.number().int(),
    createdAt: IsoDate,
    updatedAt: IsoDate,
  }),
  z.object({
    type: z.literal("memory_revision"),
    id: Id,
    documentId: Id,
    revision: z.number().int(),
    content: z.string(),
    sourceThreadId: Id.nullable(),
    createdAt: IsoDate,
  }),
  z.object({
    type: z.literal("routine"),
    id: Id,
    threadId: Id,
    name: z.string(),
    prompt: z.string(),
    crons: z.array(z.string()),
    timezone: z.string(),
    active: z.boolean(),
    notify: z.boolean(),
    modelProvider: z.string().nullable(),
    modelId: z.string().nullable(),
    thinkingLevel: z.string().nullable(),
    watch: json.nullable(),
    createdAt: IsoDate,
  }),
  /** Skills the user wrote; built-in and plugin skills come with the install. */
  z.object({
    type: z.literal("agent_skill"),
    id: Id,
    name: z.string(),
    description: z.string(),
    content: z.string(),
    files: json.nullable(),
    createdAt: IsoDate,
  }),
]);
export type AccountExportRecord = z.infer<typeof AccountExportRecordSchema>;

export const AccountImportResultSchema = z.object({
  spaces: z.array(z.object({ id: Id, name: z.string() })),
});
export type AccountImportResult = z.infer<typeof AccountImportResultSchema>;
