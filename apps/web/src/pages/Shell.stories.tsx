import type { Bot, Me, ProductEvent, ThreadMessage, ThreadSnapshot } from "@labradoodle/contracts";
import { BOT_COLOR_LIST, MODEL_REQUIRED_SEND_ERROR } from "@labradoodle/core";
import { ORPCError } from "@orpc/server";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { App } from "../App";
import { clearComposerDrafts } from "../lib/composer-draft";
import {
  getResponseStreamingPreference,
  setResponseStreamingPreference,
} from "../lib/response-streaming";
import { reduceThreadSnapshot } from "../lib/thread-events";
import {
  getToolActivityPreference,
  setToolActivityPreference,
} from "../lib/tool-activity-preference";
import type { ApiFixtures } from "../storybook/api";
import { api } from "../storybook/api";
import {
  BOOTSTRAP,
  BOTS,
  bot,
  CHIEF,
  GROUP,
  GROUP_THREAD,
  LEDGER,
  ME,
  MESSAGES,
  NOW,
  SCOUT,
  SPACE,
  SPACE_ID,
  say,
} from "../storybook/fixtures";

const ATLAS = bot({
  id: "bot-4",
  name: "Atlas",
  color: BOT_COLOR_LIST[3]!.hex,
  description: "Plans trips and events.",
  createdAt: NOW,
});

function emptyThread(botId: string): ThreadSnapshot {
  return {
    threadId: `thread-${botId}`,
    botId,
    cursor: 0,
    messages: [],
    olderCursor: null,
    run: null,
  };
}

function chat(
  thread: ThreadSnapshot,
  {
    me = ME,
    bots = BOTS,
    threads,
  }: { me?: Me; bots?: Bot[]; threads?: ApiFixtures["threads"] } = {},
) {
  const snapshot = (input: { botId?: string; groupId?: string }) =>
    input.groupId
      ? GROUP_THREAD
      : input.botId === thread.botId
        ? thread
        : emptyThread(input.botId ?? CHIEF.id);
  const space = { ...SPACE, bots, botCount: bots.length };
  return api({
    me,
    bootstrap: { ...BOOTSTRAP, me, bots, thread, spaces: [space] },
    spaces: {
      list: {
        current: {
          id: SPACE_ID,
          name: SPACE.name,
          bots,
          groups: [GROUP],
          externalConversations: [],
          botSections: [],
        },
        spaces: [space],
      },
    },
    threads: {
      head: (input) => {
        const { threadId, cursor } = snapshot(input);
        return { threadId, cursor };
      },
      get: snapshot,
      ...threads,
    },
  });
}

const RUN: Partial<ProductEvent>[] = [
  {
    type: "thread.message.created",
    payload: {
      messageId: "user-1",
      role: "user",
      blocks: [{ kind: "text", text: "Find time with Sam next week and draft the invite." }],
    },
  },
  { type: "run.started", payload: { trigger: "user" } },
  {
    type: "thread.message.created",
    payload: {
      messageId: "bot-1",
      role: "bot",
      blocks: [{ kind: "text", text: "Checking both calendars first." }],
    },
  },
  { type: "agent.tool.called", payload: { name: "calendar_list_events" } },
  { type: "agent.tool.called", payload: { name: "calendar_list_events" } },
  { type: "agent.tool.called", payload: { name: "inbox_search" } },
  { type: "agent.tool.called", payload: { name: "web_search" } },
  {
    type: "thread.progress",
    payload: {
      text: "Tuesday at 2 pm is free for both of you. Drafting the invite",
      streaming: true,
    },
  },
];
const RUN_EVENTS = RUN.map<ProductEvent>((event, index) => ({
  id: `event-${index + 1}`,
  spaceId: SPACE_ID,
  threadId: CHIEF.threadId,
  botId: CHIEF.id,
  seq: index + 1,
  type: "thread.progress",
  runId: "run-1",
  createdAt: NOW,
  payload: {},
  ...event,
}));
const STORED = 3;
const working = RUN_EVENTS.slice(0, STORED).reduce<ThreadSnapshot>(
  (snapshot, event) => reduceThreadSnapshot(snapshot, event) ?? snapshot,
  { ...emptyThread(CHIEF.id), threadId: CHIEF.threadId },
);

async function* liveRun() {
  yield* RUN_EVENTS.slice(STORED);
  await new Promise(() => {});
}

const reply = (text: string) => say("bot", text);
const ask = (text: string) => say("user", text);

const longThread: ThreadMessage[] = [
  ask("Can you compare our three pricing plans and suggest changes for next quarter?"),
  reply(
    [
      "## Current plans",
      "Here's how the plans compare today:",
      "| Plan | Price | Seats | Churn |\n| --- | ---: | ---: | ---: |\n| Free | $0 | 1 | 9.4% |\n| Team | $12 | 10 | 3.1% |\n| Business | $29 | Unlimited | 1.2% |",
      "### What stands out",
      "- **Team** carries most of the revenue but churns at three times the Business rate.\n- **Free** converts best when people invite a second seat.\n- Nobody on **Business** uses more than 40 seats.",
      "> Most Team cancellations mention the 10 seat cap in their exit survey.",
    ].join("\n\n"),
  ),
  ask("What would you change?"),
  reply(
    [
      "Three changes, in order of impact:",
      "1. **Raise the Team cap to 15 seats.** It removes the most common reason to leave.\n2. **Add a seat to Free.** A second seat is the strongest signal of conversion.\n3. **Cap Business at 50 seats** and offer a custom plan above that.",
      "I'd test the first change for a month before the other two.",
    ].join("\n\n"),
  ),
  ask("Can you show me how you'd calculate the churn impact?"),
  reply(
    [
      "Sure. This estimates the monthly accounts kept by the higher cap:",
      "```ts\ntype Plan = { accounts: number; churn: number; capReasons: number };\n\nexport function keptAccounts(team: Plan, capFix = 0.6): number {\n  const leaving = team.accounts * team.churn;\n  return Math.round(leaving * team.capReasons * capFix);\n}\n\nconst kept = keptAccounts({ accounts: 4_200, churn: 0.031, capReasons: 0.45 });\n```",
      "With 4,200 Team accounts, that's about **35 accounts a month**, or roughly `$5,000` in yearly revenue kept per month of the change.",
    ].join("\n\n"),
  ),
  ask("Great. Put the plan in a short checklist for the team."),
  reply(
    "- [x] Pull churn by plan\n- [x] Read exit surveys\n- [ ] Raise the Team cap to 15 seats\n- [ ] Add a second Free seat\n- [ ] Draft the custom Business plan\n\nI'll share this with **Scout** and **Ledger** once you approve.",
  ),
];

const failedRun: ThreadSnapshot = {
  threadId: CHIEF.threadId,
  botId: CHIEF.id,
  cursor: MESSAGES.length + 1,
  olderCursor: null,
  messages: [...MESSAGES, ask("Now send the summary to the team.")],
  run: {
    id: "run-failed",
    botId: CHIEF.id,
    threadId: CHIEF.threadId,
    taskId: "task-failed",
    status: "failed",
    trigger: "user",
    routineId: null,
    modelProvider: "example",
    modelId: "example-large",
    error: '429: {"message":"Too many requests"}',
    startedAt: NOW,
    completedAt: NOW,
    createdAt: NOW,
  },
};

const meta = {
  title: "Views/Shell",
  component: App,
  decorators: [
    (Story) => (
      <div className="h-dvh">
        <Story />
      </div>
    ),
  ],
  parameters: { route: `/app/${CHIEF.id}` },
  beforeEach: () => {
    clearComposerDrafts();
  },
} satisfies Meta<typeof App>;

export default meta;
type Story = StoryObj<typeof meta>;

export const BotWorking: Story = {
  beforeEach: () => {
    const tools = getToolActivityPreference();
    const streaming = getResponseStreamingPreference();
    setToolActivityPreference("on");
    setResponseStreamingPreference("on");
    return () => {
      setToolActivityPreference(tools);
      setResponseStreamingPreference(streaming);
    };
  },
  parameters: {
    api: chat(working, {
      threads: { subscribe: liveRun },
      bots: [
        { ...CHIEF, status: "running", preview: "Checking both calendars first." },
        SCOUT,
        LEDGER,
      ],
    }),
  },
};

export const EmptyNewChat: Story = {
  parameters: {
    route: `/app/${ATLAS.id}`,
    api: chat(emptyThread(ATLAS.id), { bots: [...BOTS, ATLAS] }),
  },
};

export const LongThread: Story = {
  parameters: {
    api: chat({
      threadId: CHIEF.threadId,
      botId: CHIEF.id,
      cursor: longThread.at(-1)!.seq,
      olderCursor: null,
      messages: longThread,
      run: null,
    }),
  },
};

export const FailedRun: Story = {
  parameters: { api: chat(failedRun) },
  beforeEach: () => {
    localStorage.removeItem("rakazo:seen-run-error:run-failed");
  },
};

export const NeedsModel: Story = {
  parameters: {
    route: `/app/${ATLAS.id}`,
    api: chat(emptyThread(ATLAS.id), {
      me: { ...ME, needsModel: true, defaultProvider: null, defaultModel: null },
      bots: [...BOTS, ATLAS],
      threads: {
        send: () => {
          throw new ORPCError("BAD_REQUEST", { message: MODEL_REQUIRED_SEND_ERROR });
        },
      },
    }),
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(await canvas.findByRole("combobox", { name: "Message Atlas" }), "Hi");
    await userEvent.click(canvas.getByRole("button", { name: "Send" }));
  },
};

export const Phone: Story = {
  globals: { viewport: { value: "mobile2", isRotated: false } },
};
