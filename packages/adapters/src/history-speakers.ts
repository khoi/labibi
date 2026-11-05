import type { PrismaClient } from "@labradoodle/db";
import { loadMessageAuthors } from "@labradoodle/db";

/** What the model reads for the person of a chat with no one else: never their real name. */
export const USER_SPEAKER = "User";
/** Label for a bot whose record is gone, so its messages are still not mistaken for the receiver's own. */
export const UNKNOWN_BOT_SPEAKER = "another bot";

/**
 * A bot's name as it appears in a label: one line, no brackets (so a name cannot close or fake
 * a `[Name]:` label), and never the human's label (a bot called "user" reads as "User (bot)").
 */
export function speakerName(name: string): string {
  const clean = labelText(name);
  if (!clean) return UNKNOWN_BOT_SPEAKER;
  return clean.toLowerCase() === USER_SPEAKER.toLowerCase() ? `${USER_SPEAKER} (bot)` : clean;
}

/** A display name is free text; a label only needs to tell people apart. */
const PERSON_NAME_MAX = 64;

/**
 * A person's name as it appears in a label in a space several people share: the same cleaning
 * as a bot's, so a name cannot fake another speaker's label.
 */
export function personSpeakerName(name: string): string {
  return labelText(name).slice(0, PERSON_NAME_MAX) || USER_SPEAKER;
}

/** One line with no brackets, so a name can never close or fake a `[Name]:` label. */
function labelText(name: string): string {
  return name
    .replace(/[[\]]/g, (bracket) => (bracket === "[" ? "(" : ")"))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Labels for the people of a chat several people are in, by user id: the runner and every author
 * in `rows`, former members included. Null in a chat with one person, whose prompts never name anyone.
 */
export async function loadChatPeople(
  prisma: Pick<PrismaClient, "user">,
  memberCount: number,
  runnerUserId: string,
  rows: Array<{ authorUserId?: string | null }>,
): Promise<Map<string, string> | null> {
  if (memberCount < 2) return null;
  const authors = await loadMessageAuthors(prisma, [
    runnerUserId,
    ...rows.map((row) => row.authorUserId),
  ]);
  return new Map([...authors].map(([id, author]) => [id, personSpeakerName(author.name)]));
}

/** The label of a person's line: their name in a chat with several people, otherwise "User". */
export function personSpeaker(
  people: ReadonlyMap<string, string> | null | undefined,
  userId: string | null | undefined,
): string {
  return (userId && people?.get(userId)) || USER_SPEAKER;
}

/**
 * A line that starts like a `[Name]:` label, with the brackets swapped for parentheses, so text
 * inside a message cannot pose as another speaker's turn once turns are joined.
 */
export function neutralizeSpeakerLabels(text: string): string {
  return text.replace(/^([ \t]*)\[([^\]\n]*)\]:/gm, "$1($2):");
}

/**
 * Who is speaking in a chat several people are in, from Doodle's side. A chat with one person has
 * no speakers: Doodle and the person are the only two parties there, so roles say it all.
 */
export interface ThreadSpeakers {
  /** The receiving bot; its own messages stay unlabelled assistant turns. */
  botId: string;
  /** Current names of the other bots, archived ones included. A renamed bot has one name everywhere. */
  names: Map<string, string>;
  /** People's labels by user id in a shared space; without them every person is "User". */
  people?: ReadonlyMap<string, string> | null;
}

type SpeakerRow = {
  role: string;
  botId?: string | null;
  authorUserId?: string | null;
  blocks?: unknown;
};

/** Null for a chat with one person, which needs no labels. */
export function chatSpeakers(
  botId: string,
  people: ReadonlyMap<string, string> | null,
): ThreadSpeakers | null {
  return people ? { botId, names: new Map(), people } : null;
}

/** The label of a person's line. */
export function personLineSpeaker(
  people: ReadonlyMap<string, string> | null | undefined,
  row: { authorUserId?: string | null },
): string {
  return personSpeaker(people, row.authorUserId);
}

/**
 * The label a message carries in the receiving bot's history, or undefined for an unlabelled one:
 * the bot's own replies and system rows.
 * Another bot is named even after it was archived; once its record is gone it is "another bot".
 * Two bots with the same name share a label; the roster the model reads lists them apart.
 */
export function historySpeaker(
  speakers: ThreadSpeakers | null | undefined,
  row: SpeakerRow,
): string | undefined {
  if (!speakers) return undefined;
  if (row.role === "user") return personLineSpeaker(speakers.people, row);
  if (row.role !== "bot" || !row.botId || row.botId === speakers.botId) return undefined;
  return speakers.names.get(row.botId) ?? UNKNOWN_BOT_SPEAKER;
}
