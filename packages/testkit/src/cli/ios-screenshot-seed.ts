import { readFile } from "node:fs/promises";
import type { BotSecretDestination, MessageBlock } from "@labradoodle/contracts";
import { encodeCardSecret, encodeContactSecret, encodeLoginSecret } from "@labradoodle/contracts";
import { createDb, createThreadMessage } from "@labradoodle/db";
import { pageViewerCode } from "@labradoodle/page-kit/compile";
import { PNG } from "pngjs";
import { sessionCookieHeader } from "../index.js";

const MARKER = "marigold checklist";
const READY = "The fixture workspace is ready.";
const GROUP_READY = "The fixture launch plan is ready.";
const TEAM_ASK = "@Doodle can you pull the launch plan together?";
const FILE_NAME = "launch-notes.txt";
const PAGE_TITLE = "Launch dashboard";
const PAGE_SOURCE = [
  "const App = () => (",
  '  <Page title="Launch dashboard" summary="Fixture figures for the screenshot catalog.">',
  '    <Metrics metrics={[{ value: "128", label: "Signups" }, { value: "4.2%", label: "Trial to paid" }]} />',
  "  </Page>",
  ");",
  "export default App;",
].join("\n");
const IMAGE_NAME = "launch-chart.png";
const NOTES = [
  "Launch notes",
  "",
  "1. Confirm the pricing page copy.",
  "2. Collect three customer quotes.",
  "3. Publish the changelog on launch day.",
].join("\n");

export interface IosScreenshotFixture {
  /** A chat with only the user and Doodle, holding the fixture's files, page and routine. */
  threadId: string;
  /** A chat with a teammate and Doodle. */
  teamThreadId: string;
  routineId: string;
  artifactId: string;
  markdownId: string;
  imageId: string;
  pdfId: string;
  archiveId: string;
  videoId: string;
  teamSpaceId: string;
  /** A chat that shows the cards Doodle sends when it needs something. */
  cardsThreadId: string;
}

interface ChatRow {
  id: string;
  name: string | null;
}

interface RoutineRow {
  id: string;
  name: string;
  active: boolean;
}

interface ArtifactRow {
  id: string;
  name: string;
  size: number;
}

interface MeRow {
  userId: string;
  spaceId: string;
}

export async function seedIosScreenshotFixture(input: {
  apiUrl: string;
  databaseUrl: string;
  email: string;
  emptyEmail: string;
  password: string;
}): Promise<IosScreenshotFixture> {
  const populated = await ensureUser(input.apiUrl, input.email, input.password, "Screenshot User");
  const empty = await ensureUser(input.apiUrl, input.emptyEmail, input.password, "Empty User");
  // Someone else in the screenshot user's workspace, so a chat can hold more than one person.
  const teammate = await ensureUser(
    input.apiUrl,
    input.email.replace("@", "+teammate@"),
    input.password,
    "Dana Teammate",
  );
  // Signing up starts a chat with Doodle; the empty account shows the list without any.
  for (const chat of await rpc<ChatRow[]>(input.apiUrl, empty.headers, "threads/list")) {
    await rpc(input.apiUrl, empty.headers, "threads/delete", { threadId: chat.id });
  }

  const me = await rpc<MeRow>(input.apiUrl, populated.headers, "me");
  const teammateMe = await rpc<MeRow>(input.apiUrl, teammate.headers, "me");
  const doodle = await rpc<{ id: string }>(input.apiUrl, populated.headers, "doodle/get");
  const workspace = await rpc<{ members: { userId: string }[] }>(
    input.apiUrl,
    populated.headers,
    "spaces/members/list",
    { spaceId: me.spaceId },
  );
  if (!workspace.members.some((member) => member.userId === teammateMe.userId)) {
    const invite = await rpc<{ url: string }>(
      input.apiUrl,
      populated.headers,
      "spaces/invites/create",
      { spaceId: me.spaceId },
    );
    const token = new URL(invite.url).pathname.split("/").pop() ?? "";
    await rpc(input.apiUrl, teammate.headers, "spaces/invites/accept", { token });
  }

  const chats = await rpc<ChatRow[]>(input.apiUrl, populated.headers, "threads/list");
  const ensureChat = async (name: string, userIds: string[]) =>
    chats.find((chat) => chat.name === name) ??
    rpc<ChatRow>(input.apiUrl, populated.headers, "threads/create", {
      name,
      userIds,
      doodle: true,
    });
  const research = await ensureChat("Product research", []);
  const team = await ensureChat("Launch team", [teammateMe.userId]);
  const cards = await ensureChat("Support digest", []);
  // The chat signup started has no name; the inbox shows only the fixture's own.
  for (const chat of chats.filter((row) => row.name === null)) {
    await rpc(input.apiUrl, populated.headers, "threads/delete", { threadId: chat.id });
  }

  const routines = await rpc<RoutineRow[]>(input.apiUrl, populated.headers, "routines/list", {
    threadId: research.id,
  });
  let routine = routines.find((item) => item.name === "Weekly fixture review");
  if (!routine) {
    routine = await rpc<RoutineRow>(input.apiUrl, populated.headers, "routines/create", {
      threadId: research.id,
      name: "Weekly fixture review",
      prompt: "Review the fixture launch notes and summarize the open questions.",
      crons: ["0 9 * * 1"],
      timezone: "UTC",
      active: false,
      notify: true,
    });
  }

  if (routine.active) {
    await rpc(input.apiUrl, populated.headers, "routines/update", {
      routineId: routine.id,
      active: false,
    });
  }

  // A Pro user brings their own provider; the offline fixture accepts this key.
  const credentials = await rpc<unknown[]>(input.apiUrl, populated.headers, "models/credentials");
  if (credentials.length === 0) {
    const model = { provider: "openrouter", modelId: "anthropic/claude-fable-5.1" };
    await rpc(input.apiUrl, populated.headers, "models/connect", {
      ...model,
      apiKey: "fixture-openrouter-key",
    });
    await rpc(input.apiUrl, populated.headers, "models/setDefault", model);
  }
  // Most people who reach the wallet have connected one; the emulator connects on the first poll.
  const wallet = await rpc<{ status: string }>(
    input.apiUrl,
    populated.headers,
    "paymentWallet/status",
  );
  if (wallet.status !== "connected") {
    await rpc(input.apiUrl, populated.headers, "paymentWallet/connect");
    // The first sign-in check waits out the provider's poll interval.
    const deadline = Date.now() + 15_000;
    while (
      (await rpc<{ status: string }>(input.apiUrl, populated.headers, "paymentWallet/status"))
        .status !== "connected"
    ) {
      if (Date.now() > deadline) throw new Error("The wallet emulator never connected");
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  const rules = await rpc<{ matchValue: string }[]>(
    input.apiUrl,
    populated.headers,
    "approvalRules/list",
  );
  if (!rules.some((rule) => rule.matchValue === "example.com")) {
    await rpc(input.apiUrl, populated.headers, "approvalRules/set", {
      effect: "always_allow",
      matchKind: "site",
      matchValue: "example.com",
    });
  }
  // One of each kind people save: a website sign-in, a card, a contact, an API token, and a
  // command variable. The card number is a well-known test number, not a real card.
  const vault = await rpc<{ name: string }[]>(input.apiUrl, populated.headers, "vault/list");
  const vaultEntries: { destination: BotSecretDestination; value: string; title?: string }[] = [
    {
      title: "Help desk",
      destination: {
        name: "help-desk",
        origin: "https://help.example.com",
        auth: { type: "login" },
      },
      value: encodeLoginSecret({
        fields: [
          { label: "Email", value: "support@example.com", hidden: false },
          { label: "Password", value: "fixture-password", hidden: true },
        ],
      }),
    },
    {
      destination: {
        name: "status-api",
        origin: "https://api.example.com",
        auth: { type: "bearer" },
      },
      value: "fixture-status-token",
    },
    {
      title: "Home",
      destination: { name: "home", origin: "", auth: { type: "contact" } },
      value: encodeContactSecret({
        name: "Sam Fixture",
        line1: "1 Example Street",
        city: "Springfield",
        postalCode: "12345",
      }),
    },
    {
      destination: { name: "visa-4242", origin: "", auth: { type: "card" } },
      value: encodeCardSecret({
        number: "4242424242424242",
        expMonth: 8,
        expYear: 2030,
        billing: "home",
      }),
    },
    {
      destination: { name: "deploy_token", origin: "", auth: { type: "command" } },
      value: "fixture-deploy-token",
    },
  ];
  for (const credential of vaultEntries) {
    if (vault.some((secret) => secret.name === credential.destination.name)) continue;
    await rpc(input.apiUrl, populated.headers, "vault/put", credential);
  }

  const stored = await rpc<ArtifactRow[]>(input.apiUrl, populated.headers, "artifacts/list", {
    threadId: research.id,
  });
  const upload = async (name: string, mimeType: string, bytes: Buffer) =>
    stored.find((artifact) => artifact.name === name) ??
    rpc<ArtifactRow>(input.apiUrl, populated.headers, "artifacts/create", {
      threadId: research.id,
      name,
      mimeType,
      contentBase64: bytes.toString("base64"),
    });
  const notes = await upload(FILE_NAME, "text/plain", Buffer.from(NOTES));
  const plan = await upload(
    "launch-plan.md",
    "text/markdown",
    Buffer.from(
      "# Launch plan\n\n**Owner:** Dana\n\n- [x] Draft the announcement\n- [ ] Collect customer quotes\n- [ ] Publish the changelog\n",
    ),
  );
  const image = await upload(IMAGE_NAME, "image/png", chartPng());
  const pdf = await upload("launch-brief.pdf", "application/pdf", briefPdf());
  // An empty archive: a type no client previews.
  const archive = await upload(
    "launch-assets.zip",
    "application/zip",
    Buffer.from([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)]),
  );

  // The product demo already in the repository, so the video viewer has something real to play.
  const video = await upload(
    "launch-demo.mp4",
    "video/mp4",
    await readFile(new URL("../../../../docs/screenshots/demo.mp4", import.meta.url)),
  );

  const db = createDb(input.databaseUrl, { applicationName: "ios-screenshots" });
  try {
    await ensureThreadCopy(db.prisma, {
      threadId: research.id,
      botId: doodle.id,
      userId: me.userId,
      artifact: notes,
    });
    await ensureActivity(db.prisma, {
      threadId: research.id,
      botId: doodle.id,
      spaceId: me.spaceId,
      userId: me.userId,
    });
    await ensureText(
      db.prisma,
      team.id,
      { role: "user", authorUserId: teammateMe.userId },
      TEAM_ASK,
    );
    await ensureText(db.prisma, team.id, { role: "bot", botId: doodle.id }, GROUP_READY);
    await ensurePage(db.prisma, {
      threadId: research.id,
      botId: doodle.id,
      spaceId: me.spaceId,
      userId: me.userId,
    });
    await ensureMemoryNotes(db.prisma, {
      spaceId: me.spaceId,
      userId: me.userId,
      threadId: research.id,
    });
    await ensureRequestCards(db.prisma, {
      threadId: cards.id,
      botId: doodle.id,
      userId: me.userId,
    });
    await ensureWaitingKeyRequest(input.apiUrl, populated.headers, cards.id);
    return {
      threadId: research.id,
      teamThreadId: team.id,
      routineId: routine.id,
      artifactId: notes.id,
      markdownId: plan.id,
      imageId: image.id,
      pdfId: pdf.id,
      archiveId: archive.id,
      videoId: video.id,
      teamSpaceId: me.spaceId,
      cardsThreadId: cards.id,
    };
  } finally {
    await db.prisma.$disconnect();
    await db.pool.end();
  }
}

/** A note the chat's people share and one of the person's own, for the memory screens. */
async function ensureMemoryNotes(
  prisma: ReturnType<typeof createDb>["prisma"],
  input: { spaceId: string; userId: string; threadId: string },
) {
  const notes = [
    {
      threadId: input.threadId,
      path: "preferences.md",
      content:
        "# Preferences\n\n- Cite a source for every claim.\n- Keep summaries under five bullets.\n",
    },
    {
      threadId: null,
      path: "team.md",
      content:
        "# Launch team\n\n- Dana owns the announcement.\n- Lee reviews every customer quote.\n",
    },
  ];
  for (const note of notes) {
    const existing = await prisma.memoryDocument.findFirst({
      where: {
        spaceId: input.spaceId,
        userId: input.userId,
        threadId: note.threadId,
        path: note.path,
      },
      select: { id: true },
    });
    if (existing) continue;
    await prisma.memoryDocument.create({
      data: { ...note, spaceId: input.spaceId, userId: input.userId },
    });
  }
}

/** A page Doodle built, named in its reply with the card under it, for the page screens. */
async function ensurePage(
  prisma: ReturnType<typeof createDb>["prisma"],
  input: { threadId: string; botId: string; spaceId: string; userId: string },
) {
  const existing = await prisma.page.findFirst({
    where: { userId: input.userId, spaceId: input.spaceId, title: PAGE_TITLE },
    select: { id: true },
  });
  if (existing) return;
  const page = await prisma.page.create({
    data: {
      spaceId: input.spaceId,
      userId: input.userId,
      threadId: input.threadId,
      title: PAGE_TITLE,
      versions: {
        create: {
          version: 1,
          title: PAGE_TITLE,
          source: PAGE_SOURCE,
          code: pageViewerCode(PAGE_SOURCE),
        },
      },
    },
  });
  await createThreadMessage(prisma, {
    threadId: input.threadId,
    role: "bot",
    botId: input.botId,
    blocks: [
      { kind: "text", text: `I made a [${PAGE_TITLE}](page:${page.id}) from the launch notes.` },
      { kind: "page", pageId: page.id, version: 1, title: PAGE_TITLE },
    ],
  });
}

async function ensureThreadCopy(
  prisma: ReturnType<typeof createDb>["prisma"],
  input: { threadId: string; botId: string; userId: string; artifact: ArtifactRow },
) {
  const messages = await prisma.message.findMany({
    where: { threadId: input.threadId },
    select: { blocks: true },
  });
  const serialized = messages.map((message) => JSON.stringify(message.blocks));
  if (!serialized.some((blocks) => blocks.includes(READY))) {
    await createThreadMessage(prisma, {
      threadId: input.threadId,
      role: "user",
      authorUserId: input.userId,
      blocks: [{ kind: "text", text: "Summarize the launch notes." }],
    });
    await createThreadMessage(prisma, {
      threadId: input.threadId,
      role: "bot",
      botId: input.botId,
      blocks: [
        {
          kind: "text",
          text: [
            READY,
            "",
            "**Checklist** with *italic* and `code`.",
            "",
            `The unique search phrase is ${MARKER}.`,
            "",
            "![Remote diagram](https://example.com/diagram.png)",
          ].join("\n"),
        },
        {
          kind: "file",
          artifactId: input.artifact.id,
          mimeType: "text/plain",
          name: FILE_NAME,
          size: input.artifact.size,
        },
      ],
    });
  }
}

async function ensureActivity(
  prisma: ReturnType<typeof createDb>["prisma"],
  input: { threadId: string; botId: string; spaceId: string; userId: string },
) {
  const existing = await prisma.run.findFirst({
    where: { threadId: input.threadId, status: "completed" },
    select: { id: true },
  });
  if (existing) return;
  const source = await prisma.message.findFirst({
    where: { threadId: input.threadId, role: "user" },
    select: { id: true },
  });
  const task = await prisma.task.create({
    data: {
      spaceId: input.spaceId,
      userId: input.userId,
      botId: input.botId,
      threadId: input.threadId,
      prompt: "Prepare the fixture workspace",
      status: "completed",
    },
  });
  await prisma.run.create({
    data: {
      spaceId: input.spaceId,
      userId: input.userId,
      botId: input.botId,
      threadId: input.threadId,
      taskId: task.id,
      status: "completed",
      trigger: "user",
      modelProvider: "scripted",
      modelId: "scripted",
      sourceMessageId: source?.id,
      startedAt: new Date(Date.now() - 2_000),
      completedAt: new Date(),
    },
  });
}

/** A small bar chart, so the image viewer has something to show. */
function chartPng() {
  const png = new PNG({ width: 480, height: 320 });
  const bars = [120, 200, 160, 260, 220];
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const bar = Math.floor((x - 40) / 84);
      const inBar = x >= 40 && (x - 40) % 84 < 60 && bar < bars.length;
      const filled = inBar && png.height - 30 - y < (bars[bar] ?? 0) && y < png.height - 30;
      const offset = (y * png.width + x) * 4;
      const shade = filled ? 40 + bar * 30 : 248;
      png.data[offset] = shade;
      png.data[offset + 1] = shade;
      png.data[offset + 2] = filled ? shade + 20 : 248;
      png.data[offset + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

/** A one-page PDF with a heading and two lines, built by hand so no PDF library is needed. */
function briefPdf() {
  const text = [
    "BT /F1 28 Tf 72 720 Td (Launch brief) Tj ET",
    "BT /F1 14 Tf 72 680 Td (Ship the announcement on Tuesday.) Tj ET",
    "BT /F1 14 Tf 72 656 Td (Quotes and changelog are the last open items.) Tj ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = body.length;
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

const CARDS_READY = "Set up the weekly support digest.";

/** The cards Doodle shows when it needs something: a key, a sign-in, a site, an app, a choice. */
async function ensureRequestCards(
  prisma: ReturnType<typeof createDb>["prisma"],
  input: { threadId: string; botId: string; userId: string },
) {
  const messages = await prisma.message.findMany({
    where: { threadId: input.threadId },
    select: { blocks: true },
  });
  if (messages.some((message) => JSON.stringify(message.blocks).includes(CARDS_READY))) return;
  const bot = (blocks: MessageBlock[]) =>
    createThreadMessage(prisma, {
      threadId: input.threadId,
      role: "bot",
      botId: input.botId,
      blocks,
    });
  await createThreadMessage(prisma, {
    threadId: input.threadId,
    role: "user",
    authorUserId: input.userId,
    blocks: [{ kind: "text", text: CARDS_READY }],
  });
  await bot([
    { kind: "text", text: "I'll read new tickets from the help desk and draft replies." },
    {
      kind: "app_connect",
      provider: "gmail",
      name: "Gmail",
      description: "Search, read, and draft emails",
      logo: null,
      status: "pending",
    },
  ]);
  await bot([
    {
      kind: "ask",
      text: "Sign in to the help desk so I can see the ticket queue.",
      input: "secret",
      purpose: "password",
      credential: {
        name: "help-desk",
        origin: "https://help.example.com",
        auth: { type: "login" },
      },
      status: "answered",
    },
  ]);
  await bot([
    {
      kind: "ask",
      text: "Can I open status.example.com to check for outages?",
      site: "status.example.com",
      status: "answered",
      answer: "Allow",
    },
  ]);
  await bot([
    { kind: "computer", state: "Needs you", text: "Approve the sign-in code on your phone." },
  ]);
}

/**
 * A live request for a key: its card only offers a field while Doodle's run waits for the
 * answer, so the offline scripted runtime asks for real, as the web tests have it do.
 */
async function ensureWaitingKeyRequest(
  apiUrl: string,
  headers: Record<string, string>,
  threadId: string,
) {
  type Snapshot = { run?: { status: string; error?: string | null } | null };
  let last: Snapshot["run"] = null;
  const waiting = async () => {
    last = (await rpc<Snapshot>(apiUrl, headers, "threads/get", { threadId })).run;
    return last?.status === "waiting_input";
  };
  if (await waiting()) return;
  await rpc(apiUrl, headers, "threads/send", {
    threadId,
    text: "Check the status API too, and request a masked api key if you need one.",
  });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await waiting()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`The scripted Doodle never asked for a key; its run: ${JSON.stringify(last)}`);
}

async function ensureText(
  prisma: ReturnType<typeof createDb>["prisma"],
  threadId: string,
  author: { role: "user"; authorUserId: string } | { role: "bot"; botId: string },
  text: string,
) {
  const messages = await prisma.message.findMany({
    where: { threadId },
    select: { blocks: true },
  });
  if (messages.some((message) => JSON.stringify(message.blocks).includes(text))) return;
  await createThreadMessage(prisma, { threadId, ...author, blocks: [{ kind: "text", text }] });
}

async function ensureUser(apiUrl: string, email: string, password: string, name: string) {
  const signup = await postAuth(apiUrl, "sign-up", { email, password, name });
  const session = signup.ok ? signup : await postAuth(apiUrl, "sign-in", { email, password });
  if (!session.ok || !session.token) {
    throw new Error(
      `Could not sign in fixture user (${session.status})${session.message ? `: ${session.message}` : ""}`,
    );
  }
  return {
    headers: {
      authorization: `Bearer ${session.token}`,
      cookie: session.cookie,
      origin: "labradoodle://",
    },
  };
}

async function postAuth(
  apiUrl: string,
  action: "sign-in" | "sign-up",
  body: { email: string; password: string; name?: string },
) {
  const response = await fetch(`${apiUrl}/api/auth/${action}/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "labradoodle://" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  const message =
    parsed &&
    typeof parsed === "object" &&
    "message" in parsed &&
    typeof parsed.message === "string"
      ? parsed.message
      : undefined;
  return {
    ok: response.ok,
    status: response.status,
    message,
    // The signed bearer; the server refuses the raw session token.
    token: response.headers.get("set-auth-token") ?? "",
    cookie: sessionCookieHeader(response),
  };
}

async function rpc<T>(
  apiUrl: string,
  headers: Record<string, string>,
  procedure: string,
  body: unknown = {},
): Promise<T> {
  const response = await fetch(`${apiUrl}/rpc/${procedure}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ json: body }),
  });
  const text = await response.text();
  const parsed = JSON.parse(text) as { json?: T; error?: { message?: string } };
  if (!response.ok || parsed.error) {
    const message = parsed.error?.message ?? text.slice(0, 180);
    throw new Error(`${procedure} failed (${response.status}): ${message}`);
  }
  return parsed.json as T;
}
