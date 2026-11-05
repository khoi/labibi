import type { MessageBlock, ThreadMessage } from "@labradoodle/contracts";
import { foldPeerReplies, instructionUpdateDiff } from "@labradoodle/core";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { useMemo, useRef } from "react";
import { fn } from "storybook/test";
import { rpc } from "../../lib/rpc";
import { api } from "../../storybook/api";
import { BOTS, CHIEF, GROUP, LEDGER, message, NOW, SCOUT, say } from "../../storybook/fixtures";
import { Transcript } from "./transcript";

type TranscriptStoryProps = Omit<
  ComponentProps<typeof Transcript>,
  "scrollRef" | "transcript" | "rpc"
> & { messages: ThreadMessage[] };

function TranscriptStory({ messages, ...props }: TranscriptStoryProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const transcript = useMemo(
    () => foldPeerReplies(messages, { includePeerReceipts: true }),
    [messages],
  );
  return (
    <main className="flex h-dvh flex-col bg-background text-foreground">
      <Transcript {...props} rpc={rpc} scrollRef={scrollRef} transcript={transcript} />
    </main>
  );
}

const user = (text: string, extra?: Partial<ThreadMessage>) => say("user", text, extra);
const reply = (text: string, extra?: Partial<ThreadMessage>) => say("bot", text, extra);
const bot = (blocks: MessageBlock[], extra?: Partial<ThreadMessage>) =>
  message("bot", blocks, extra);
const answerable = (messages: ThreadMessage[]) => new Set(messages.map((item) => item.id));
const findBot = (botId: string | undefined) => BOTS.find((item) => item.id === botId);

const IMAGE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320"><rect width="480" height="320" fill="silver"/><circle cx="160" cy="150" r="70" fill="darkgray"/><rect x="250" y="90" width="150" height="120" rx="12" fill="gray"/></svg>';

const plan = reply(
  "Sure. Here's the plan:\n\n1. Pull revenue and churn from the **finance sheet**\n2. Draft the summary\n3. Send it to you for review\n\nI'll use the [Q3 template](https://example.test/template) and `report.md` as the starting point.",
);
const conversation = [
  user("Can you get the Q3 report ready for Monday?"),
  plan,
  user("Keep the summary short.", {
    replyToMessageId: plan.id,
    replyQuote: "Draft the summary",
    replyPreview: { role: "bot", botId: CHIEF.id, text: "Draft the summary" },
  }),
  reply("Got it, one paragraph."),
  bot([
    {
      kind: "card",
      lines: [
        { k: "Report", v: "Q3 summary" },
        { k: "Due", v: "Monday 9:00" },
        { k: "Reviewer", v: "You" },
      ],
    },
  ]),
  bot([{ kind: "meta", text: "Reminder set for Monday 8:30" }]),
  reply(
    "| Metric | Q2 | Q3 |\n| --- | ---: | ---: |\n| Revenue | 1.2M | 1.4M |\n| Churn | 3.1% | 2.7% |\n\n```ts\nconst growth = (q3 - q2) / q2;\n```",
  ),
];

const textStyles = [
  user("Show me the text styles you can use."),
  reply(
    [
      "# Heading 1",
      "## Heading 2",
      "### Heading 3",
      "A plain paragraph that runs long enough to wrap, so line height and measure show the way a real answer reads.",
      "**Bold**, *italic*, ***bold italic***, ~~strikethrough~~, `inline code` and a [link](https://example.test).",
      "> A blockquote that also runs long enough to wrap onto a second line.",
      "- A bullet\n- Another bullet\n  - A nested bullet",
      "1. **A bold lead-in:** then the rest of the item, long enough to wrap.\n2. A second item",
      "| Plan | Price |\n| --- | --- |\n| Free | $0 |\n| Pro | $20 |",
      '```\nconst greeting = "hello";\n```',
      "---",
      "A closing paragraph after a rule.",
    ].join("\n\n"),
  ),
];

const staleAsk = bot([
  {
    kind: "ask",
    text: "Which calendar should I use?",
    status: "pending",
    actions: [
      { id: "work", label: "Work" },
      { id: "personal", label: "Personal" },
    ],
  },
]);
const questions = [
  bot([
    {
      kind: "ask",
      text: "Hi there! I'm Chief. What do you want me to help with?",
      status: "pending",
      actions: [
        { id: "lead", label: "Lead and coordinate my team's work" },
        { id: "research", label: "Research and summarize information" },
        { id: "plan", label: "Plan and track projects" },
        { id: "other", label: "Something else (I'll type it)" },
      ],
    },
  ]),
  bot([
    {
      kind: "ask",
      text: "Which city should I use?",
      status: "answered",
      answer: "seoul",
      actions: [
        { id: "berlin", label: "Berlin" },
        { id: "seoul", label: "Seoul" },
      ],
    },
  ]),
  bot([
    {
      kind: "ask",
      text: "Where should we meet?",
      status: "answered",
      answer: "Paris",
      actions: [
        { id: "berlin", label: "Berlin" },
        { id: "seoul", label: "Seoul" },
      ],
    },
  ]),
  user("Paris"),
  staleAsk,
  bot([
    {
      kind: "ask",
      text: "Here's the reply I drafted. Send it?",
      detail: "Thanks Sam, Tuesday at 2 pm works for me.",
      detailFormat: "text",
      status: "pending",
    },
  ]),
  bot([
    {
      kind: "choice",
      question: "What do you want me on first?",
      options: [
        { id: "inbox", letter: "A", label: "Inbox & email" },
        { id: "calendar", letter: "B", label: "Calendar" },
        { id: "research", letter: "C", label: "Research" },
      ],
    },
  ]),
  bot([
    {
      kind: "choice",
      question: "How often should I check in?",
      options: [
        { id: "daily", letter: "A", label: "Daily" },
        { id: "weekly", letter: "B", label: "Weekly" },
      ],
      answerId: "weekly",
    },
  ]),
];

const approvalActions = [
  { id: "allow", label: "Allow once" },
  { id: "always", label: "Always allow this tool" },
  { id: "deny", label: "Deny" },
];
const approvals = [
  bot([
    {
      kind: "ask",
      approvalEffectId: "effect-1",
      text: "Send this email from your inbox?",
      detail: "To: sam@example.test\nSubject: Re: Q3 report\n\nAttached is the draft.",
      status: "pending",
      actions: approvalActions,
    },
  ]),
  bot([
    {
      kind: "ask",
      approvalEffectId: "effect-2",
      text: "Open a page on example.test?",
      site: "example.test",
      status: "pending",
      actions: approvalActions,
    },
  ]),
  bot([
    {
      kind: "ask",
      approvalEffectId: "effect-3",
      text: "Create the space Marketing?",
      status: "pending",
      actions: [
        { id: "allow", label: "Create space", outcome: "created" },
        { id: "deny", label: "Cancel", outcome: "cancelled" },
      ],
    },
  ]),
  bot([
    {
      kind: "ask",
      approvalEffectId: "effect-5",
      text: "Update instructions?",
      status: "pending",
      instructionUpdate: {
        botId: CHIEF.id,
        before: "Reply in English.",
        after: "Reply in English. Keep summaries to one paragraph.",
        reason: "You asked for shorter summaries.",
      },
      detail: instructionUpdateDiff(
        "Reply in English.",
        "Reply in English. Keep summaries to one paragraph.",
      ),
      detailFormat: "code",
      actions: [
        { id: "allow", label: "Apply" },
        { id: "deny", label: "Dismiss" },
      ],
    },
  ]),
  bot([
    {
      kind: "ask",
      text: "Instructions updated",
      status: "answered",
      answer: "allow",
      instructionUpdate: {
        botId: CHIEF.id,
        before: "Reply in English.",
        after: "Reply in English. Be brief.",
        reason: "You asked for brevity.",
        undoVersionId: "version-1",
      },
    },
  ]),
  bot([
    {
      kind: "ask",
      text: "Settings updated",
      status: "answered",
      settingsUpdate: {
        botId: CHIEF.id,
        before: { modelProvider: "example", modelId: "example-small", thinkingLevel: "low" },
        after: { modelProvider: "example", modelId: "example-large", thinkingLevel: "high" },
      },
    },
  ]),
  bot([
    {
      kind: "ask",
      approvalEffectId: "effect-4",
      text: "Delete 12 archived files?",
      status: "answered",
      answer: "deny",
      actions: approvalActions,
    },
  ]),
];

const secrets = [
  bot([
    {
      kind: "ask",
      text: "Enter the code sent to your phone.",
      input: "secret",
      purpose: "otp",
      status: "pending",
    },
  ]),
  bot([
    {
      kind: "ask",
      text: "I need an API key for the analytics service.",
      input: "secret",
      purpose: "api_key",
      credential: { name: "ANALYTICS_KEY", origin: "", auth: { type: "command" } },
      status: "pending",
    },
  ]),
  bot([
    {
      kind: "ask",
      text: "Sign in to the vendor portal.",
      input: "secret",
      purpose: "password",
      credential: {
        name: "vendor-portal",
        origin: "https://portal.example.test",
        auth: { type: "login" },
      },
      loginFields: ["ID number", "Phone number", "PIN"],
      status: "pending",
    },
  ]),
  bot([
    {
      kind: "ask",
      text: "Enter the code sent to your phone.",
      input: "secret",
      purpose: "otp",
      status: "answered",
      answer: "",
    },
  ]),
];

const working = [
  user("Find time with Sam next week."),
  bot([
    {
      kind: "steps",
      steps: [
        { label: "Open calendar", count: 1 },
        { label: "Read events", count: 3 },
        { label: "Search inbox", count: 2 },
      ],
      durationMs: 8_200,
    },
  ]),
  bot([
    {
      kind: "subagent",
      agentId: "agent-1",
      name: "Researcher",
      task: "Compare three venues",
      status: "completed",
      result: "The Loft is cheapest and free on Tuesday.",
    },
  ]),
  bot([
    {
      kind: "subagent",
      agentId: "agent-2",
      name: "Writer",
      task: "Draft the invite",
      status: "running",
      progress: "Writing the second paragraph",
    },
  ]),
  bot([
    {
      kind: "subagent",
      agentId: "agent-3",
      name: "Booker",
      task: "Reserve the room",
      status: "failed",
      result: "The booking site timed out.",
    },
  ]),
  bot([
    {
      kind: "cloud_agent",
      agentId: "cloud-1",
      title: "Fix flaky calendar test",
      status: "running",
      url: "https://example.test/agents/cloud-1",
      branch: "fix/calendar-test",
    },
  ]),
  bot([
    {
      kind: "cloud_agent",
      agentId: "cloud-2",
      title: "Add CSV export",
      status: "finished",
      url: "https://example.test/agents/cloud-2",
      prUrl: "https://example.test/pull/42",
    },
  ]),
  bot([{ kind: "computer", state: "Needs you", text: "The site wants a captcha solved." }]),
  bot([{ kind: "computer", state: "Working", text: "Filling in the booking form." }]),
  bot([{ kind: "progress", text: "Checking Sam's calendar…" }]),
];

const liveSteps = [
  user("Find a free slot on Tuesday."),
  bot(
    [
      {
        kind: "steps",
        steps: [
          "Open calendar",
          "Read events",
          "Search inbox",
          "Read message",
          "Check time zones",
          "Compare calendars",
          "Draft invite",
          "Check conflicts",
        ].map((label) => ({ label, count: 1 })),
      },
    ],
    { id: "progress:run-1", runId: "run-1" },
  ),
];

const team = [
  user("Plan the offsite with the team."),
  bot([
    {
      kind: "bot_message_sent",
      toBotId: SCOUT.id,
      toBotName: SCOUT.name,
      text: "Find three venues near the office.",
      intent: "request",
    },
  ]),
  message("user", [
    {
      kind: "bot_message_received",
      fromBotId: SCOUT.id,
      fromBotName: SCOUT.name,
      text: "The Loft, Harbor Hall and Pine Room are free.",
      intent: "result",
    },
  ]),
  bot([{ kind: "handoff", fromBotId: CHIEF.id, toBotId: LEDGER.id, text: "Budget check" }]),
  reply("The Loft fits the budget.", { botId: LEDGER.id }),
  bot([
    {
      kind: "channel_message",
      provider: "sms",
      channelId: "channel-1",
      fromAddress: "+1 555 0100",
      fromLabel: "Sam",
      text: "Tuesday works for me",
    },
  ]),
  bot([{ kind: "child_bot", botId: SCOUT.id, name: SCOUT.name, status: "created" }]),
  bot([{ kind: "child_bot", botId: LEDGER.id, name: LEDGER.name, status: "archived" }]),
];

const groupChat = [
  user("Where are we on the launch post?", { threadId: GROUP.threadId }),
  reply("The draft is ready for review.", { threadId: GROUP.threadId, botId: SCOUT.id }),
  reply("I'll schedule it for **Tuesday morning** once you approve.", {
    threadId: GROUP.threadId,
  }),
  reply("Budget for the promoted post is approved.", {
    threadId: GROUP.threadId,
    botId: LEDGER.id,
  }),
];

const rich = [
  message("user", [
    { kind: "image", artifactId: "image-1", mimeType: "image/svg+xml", name: "whiteboard.svg" },
  ]),
  bot([
    {
      kind: "file",
      artifactId: "file-1",
      mimeType: "application/pdf",
      name: "q3-report.pdf",
      size: 184_320,
    },
  ]),
  bot([
    {
      kind: "chart",
      name: "Revenue by month",
      spec: { marks: [{ type: "barY", options: { x: "month", y: "revenue" } }] },
      data: [
        { month: "Jul", revenue: 410 },
        { month: "Aug", revenue: 465 },
        { month: "Sep", revenue: 520 },
      ],
    },
  ]),
  bot([
    {
      kind: "app_connect",
      provider: "example-docs",
      name: "Example Docs",
      description: "Read and update your pages",
      logo: null,
      status: "pending",
    },
  ]),
  bot([
    {
      kind: "app_connect",
      provider: "example-tracker",
      name: "Example Tracker",
      description: "Track issues",
      logo: null,
      status: "connected",
    },
  ]),
  bot([
    {
      kind: "mcp_approval",
      name: "Weather",
      serverId: "server-1",
      transport: "streamable_http",
      endpoint: "https://weather.example.test/mcp",
      needsOAuth: false,
      status: "pending",
    },
  ]),
  bot([
    {
      kind: "skill_draft",
      skillId: "skill-1",
      name: "Weekly report",
      goal: "Send a summary of the week every Friday",
      playbook: {
        whenToUse: "Fridays at 4 pm",
        inputs: ["Calendar", "Inbox"],
        steps: ["Collect the week's meetings", "Summarize decisions", "Email the summary"],
        howToCheck: "Every meeting is covered",
        whatToReturn: "A short email",
        approvalBoundaries: "Ask before sending",
        failureHandling: "Tell me what was missing",
      },
      status: "draft",
    },
  ]),
];

const calls = [
  bot(
    [
      {
        kind: "voice_call",
        callId: "call-paginated",
        title: "Deploy check",
        farewell: "Bye",
        durationSeconds: 125,
      },
    ],
    { callId: "call-paginated", runId: "run-paginated" },
  ),
  reply("Here is the deployment checklist.", { runId: "run-paginated" }),
  bot(
    [
      {
        kind: "call_request",
        callId: "call-1",
        reason: "The venue needs an answer today",
        opening: "Hi, quick question about the venue.",
        status: "ringing",
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
    ],
    { callId: "call-1" },
  ),
  bot(
    [
      {
        kind: "call_request",
        callId: "call-2",
        reason: "Confirm the budget",
        opening: "Hi, about the budget.",
        status: "missed",
        expiresAt: "2026-10-26T09:30:00.000Z",
      },
    ],
    { callId: "call-2" },
  ),
  user("Can we go over the offsite?", { callId: "call-3", runId: "run-3" }),
  reply("Sure. The Loft is booked for Tuesday.", { callId: "call-3", runId: "run-3" }),
  bot(
    [
      {
        kind: "voice_call",
        callId: "call-3",
        title: "Offsite planning",
        farewell: "Talk soon.",
        durationSeconds: 184,
      },
    ],
    { callId: "call-3" },
  ),
];

const NONE = new Set<string>();

const meta = {
  title: "Chat/Transcript",
  component: TranscriptStory,
  args: {
    messages: conversation,
    scrollRequest: null,
    onScrollRequestHandled: fn(),
    followRequest: 0,
    artifactTarget: { botId: CHIEF.id },
    showToolActivity: true,
    olderCursor: null,
    unreadAfterSeq: null,
    loadingOlder: false,
    answerableAskIds: NONE,
    dismissableAskIds: NONE,
    running: false,
    workingBots: [],
    onLoadOlder: fn(),
    onOpenBot: fn(),
    onAnswer: fn(async () => {}),
    onReply: fn(),
    onMarkUnread: fn(),
    onQuote: fn(),
    onReact: fn(async () => {}),
    onJumpToMessage: fn(),
    onOpenPeerMessages: fn(),
    peerBot: (botId) => findBot(botId) ?? CHIEF,
    onRefresh: fn(async () => {}),
    onBotChanged: fn(async () => {}),
    onAddRoutine: fn(),
    voiceReady: false,
    speakingMessageId: null,
    onSpeak: fn(),
    onOpenComputer: fn(),
    onOpenImportSetup: fn(),
  },
} satisfies Meta<typeof TranscriptStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Conversation: Story = {};

export const NewMessagesAndHistory: Story = {
  args: { unreadAfterSeq: conversation[3]!.seq, olderCursor: 1 },
};

export const TextStyles: Story = { args: { messages: textStyles } };

export const Questions: Story = {
  args: {
    messages: questions,
    answerableAskIds: answerable(questions.filter((item) => item !== staleAsk)),
    dismissableAskIds: answerable(questions.filter((item) => item !== staleAsk)),
  },
};

export const Approvals: Story = {
  args: {
    messages: approvals,
    answerableAskIds: answerable(approvals),
    dismissableAskIds: answerable(approvals),
  },
};

export const Secrets: Story = {
  args: {
    messages: secrets,
    answerableAskIds: answerable(secrets),
    dismissableAskIds: answerable(secrets),
  },
};

export const ToolActivity: Story = {
  args: {
    messages: working,
    running: true,
    workingBots: [{ botId: CHIEF.id, name: CHIEF.name, color: CHIEF.color }],
  },
};

export const LiveToolSteps: Story = {
  args: {
    messages: liveSteps,
    running: true,
    workingBots: [{ botId: CHIEF.id, name: CHIEF.name, color: CHIEF.color }],
  },
};

export const ToolActivityHidden: Story = {
  args: { messages: working, showToolActivity: false },
};

export const BotTeam: Story = { args: { messages: team } };

export const GroupChat: Story = {
  args: {
    messages: groupChat,
    artifactTarget: { groupId: GROUP.id },
    memberName: (botId) => findBot(botId)?.name,
  },
};

export const RichContent: Story = {
  args: { messages: rich },
  parameters: {
    api: api({
      artifacts: {
        get: (input) => ({
          id: input.artifactId,
          botId: CHIEF.id,
          groupId: null,
          runId: null,
          name: "whiteboard.svg",
          description: null,
          mimeType: "image/svg+xml",
          size: IMAGE_SVG.length,
          version: 1,
          createdAt: NOW,
          contentBase64: btoa(IMAGE_SVG),
        }),
      },
    }),
  },
};

export const Calls: Story = { args: { messages: calls, onCallBack: fn() } };
