import type {
  AppBootstrap,
  AuthCapabilities,
  Bot,
  Group,
  Me,
  MessageBlock,
  Space,
  ThreadMessage,
  ThreadSnapshot,
} from "@labradoodle/contracts";
import { BOT_COLOR_LIST } from "@labradoodle/core";
import type { MonitoringConfig } from "@labradoodle/logging/monitoring";
import type { ApiFixtures, HttpFixtures } from "./api";

export const NOW = "2026-10-26T09:00:00.000Z";
export const USER_ID = "user-1";
export const SPACE_ID = "space-1";

export const SESSION = {
  session: {
    id: "session-1",
    userId: USER_ID,
    token: "story-session",
    expiresAt: "2099-01-01T00:00:00.000Z",
    createdAt: NOW,
    updatedAt: NOW,
    activeOrganizationId: null,
  },
  user: {
    id: USER_ID,
    email: "ada@example.test",
    emailVerified: true,
    name: "Ada Park",
    image: null,
    createdAt: NOW,
    updatedAt: NOW,
  },
};

export const ME: Me = {
  ticketBoardEnabled: true,
  phoneCallsEnabled: false,
  navLinks: [],
  userId: USER_ID,
  email: SESSION.user.email,
  name: SESSION.user.name,
  spaceId: SPACE_ID,
  isDeploymentOwner: false,
  isAdmin: false,
  needsModel: false,
  defaultProvider: "example",
  defaultModel: "example-large",
  hostCredentialProvider: null,
  hostCredentialSource: null,
  computerHost: null,
  canChooseHostComputer: false,
  sandboxProvider: "docker",
  mcpStdioEnabled: false,
  avatarStyle: "robot",
  timezone: "Europe/Berlin",
  locale: "en",
  billingEnabled: false,
  needsSignupSurvey: false,
  paymentWalletProvider: null,
};

export function bot(overrides: Partial<Bot> & Pick<Bot, "id" | "name">): Bot {
  return {
    spaceId: SPACE_ID,
    title: "",
    description: "",
    instructions: "",
    color: BOT_COLOR_LIST[0]!.hex,
    notifyOnFinish: true,
    pinned: false,
    sectionId: null,
    archivedAt: null,
    unread: false,
    parentBotId: null,
    memoryScope: null,
    threadId: `thread-${overrides.id}`,
    preview: "",
    status: "idle",
    runErrorId: null,
    computerMode: "team",
    updatedAt: NOW,
    createdAt: NOW,
    voiceId: null,
    autoSpeak: false,
    modelProvider: null,
    modelId: null,
    thinkingLevel: null,
    teamChatAmbientEnabled: false,
    teamChatRules: "",
    fleetManagement: true,
    disabledBuiltinTools: [],
    webhookConfigured: false,
    spawnKey: null,
    ...overrides,
  };
}

export const CHIEF = bot({
  id: "bot-1",
  name: "Chief",
  description: "Coordinates the team and keeps plans on track.",
  preview: "Got it, one paragraph.",
  pinned: true,
});
export const SCOUT = bot({
  id: "bot-2",
  name: "Scout",
  color: BOT_COLOR_LIST[1]!.hex,
  description: "Researches and summarizes.",
  preview: "Found three sources on churn.",
  unread: true,
});
export const LEDGER = bot({
  id: "bot-3",
  name: "Ledger",
  color: BOT_COLOR_LIST[2]!.hex,
  description: "Tracks invoices and spend.",
  preview: "October invoices are filed.",
  status: "running",
});
export const BOTS = [CHIEF, SCOUT, LEDGER];

export const GROUP: Group = {
  id: "group-1",
  spaceId: SPACE_ID,
  name: "Launch team",
  pinned: false,
  sectionId: null,
  archivedAt: null,
  members: [CHIEF, SCOUT].map(({ id, name, color }) => ({ botId: id, name, color })),
  threadId: "thread-group-1",
  preview: "Scout: the launch post is drafted.",
  unread: false,
  updatedAt: NOW,
  createdAt: NOW,
};

export const SPACE: Space = {
  id: SPACE_ID,
  name: "Personal",
  isDefault: true,
  hasContent: true,
  canRename: true,
  canDelete: false,
  botCount: BOTS.length,
  bots: BOTS,
  groups: [GROUP],
  externalConversations: [],
  botSections: [],
};

let seq = 0;
export function message(
  role: ThreadMessage["role"],
  blocks: MessageBlock[],
  extra: Partial<ThreadMessage> = {},
): ThreadMessage {
  seq += 1;
  return {
    id: `message-${seq}`,
    threadId: CHIEF.threadId,
    seq,
    role,
    blocks,
    ...(role === "bot" ? { botId: CHIEF.id } : {}),
    createdAt: new Date(Date.UTC(2026, 9, 26, 9, seq)).toISOString(),
    ...extra,
  };
}

export const say = (role: ThreadMessage["role"], text: string, extra?: Partial<ThreadMessage>) =>
  message(role, [{ kind: "text", text }], extra);

export const MESSAGES: ThreadMessage[] = [
  say("user", "Can you get the Q3 report ready for Monday?"),
  say(
    "bot",
    "Sure. Here's the plan:\n\n1. Pull revenue and churn from the **finance sheet**\n2. Draft the summary\n3. Send it to you for review",
  ),
  say("user", "Keep the summary short."),
  say("bot", "Got it, one paragraph."),
];

export const GROUP_THREAD: ThreadSnapshot = {
  threadId: GROUP.threadId,
  groupId: GROUP.id,
  groupName: GROUP.name,
  members: GROUP.members,
  cursor: 3,
  olderCursor: null,
  run: null,
  messages: [
    say("user", "Where are we on the launch post?", { threadId: GROUP.threadId }),
    say("bot", "The draft is ready for review.", { threadId: GROUP.threadId, botId: SCOUT.id }),
    say("bot", "I'll schedule it for Tuesday morning.", { threadId: GROUP.threadId }),
  ],
};

export const BOOTSTRAP: AppBootstrap = {
  me: ME,
  bots: BOTS,
  groups: [GROUP],
  botSections: [],
  archivedBots: [],
  archivedGroups: [],
  thread: {
    threadId: CHIEF.threadId,
    botId: CHIEF.id,
    cursor: MESSAGES.length,
    messages: MESSAGES,
    olderCursor: null,
    run: null,
  },
  routines: [],
  spaces: [SPACE],
};

async function* quiet() {
  await new Promise(() => {});
  yield* [];
}

const ok = { ok: true } as const;

export const DEFAULT_API: ApiFixtures = {
  me: ME,
  bootstrap: BOOTSTRAP,
  analytics: { screen: ok },
  organizations: {
    list: {
      activeOrganizationId: "org-1",
      organizations: [
        {
          id: "org-1",
          name: "Personal",
          defaultSpaceId: SPACE_ID,
          spaceIds: [SPACE_ID],
          canManage: true,
        },
      ],
    },
  },
  threads: {
    head: (input) => {
      const { threadId, cursor } = input.groupId ? GROUP_THREAD : BOOTSTRAP.thread!;
      return { threadId, cursor };
    },
    get: (input) => (input.groupId ? GROUP_THREAD : BOOTSTRAP.thread!),
    markRead: { ok: true, unreadAfterSeq: null },
    subscribe: quiet,
  },
  notifications: { subscribe: quiet },
  routines: { list: [] },
  connections: { catalog: [], list: [] },
  agentSkills: { list: [] },
  trustedLinkSites: { list: [] },
  memory: { providerConfig: null },
  computer: { updates: [] },
  messaging: {
    status: { enabled: false, providers: [], openSignup: false, identities: [] },
  },
  voice: {
    status: { configured: false, ready: false, transcribe: false, provider: null, voiceId: "" },
  },
};

const capabilities: AuthCapabilities = {
  sso: null,
  passwordAuth: true,
  passwordReset: true,
  resetUrl: null,
  emailCode: true,
  passkeyRpId: null,
};

const monitoring: MonitoringConfig = { dsn: null };

export const DEFAULT_HTTP: HttpFixtures = {
  "/api/auth/get-session": SESSION,
  "/api/auth/capabilities": capabilities,
  "/api/monitoring/config": monitoring,
};
