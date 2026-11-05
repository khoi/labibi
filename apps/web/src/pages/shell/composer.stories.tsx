import type { AgentSkillCatalogEntry } from "@labradoodle/contracts";
import type { ComposerMention } from "@labradoodle/core";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { createRef } from "react";
import { fn } from "storybook/test";
import { clearComposerDrafts, writeComposerDraft } from "../../lib/composer-draft";
import { CHIEF, GROUP, LEDGER, SCOUT, say } from "../../storybook/fixtures";
import { Composer } from "./composer";

const scout: ComposerMention = { kind: "bot", id: SCOUT.id, name: SCOUT.name, color: SCOUT.color };
const mentionTargets: ComposerMention[] = [
  scout,
  { kind: "bot", id: LEDGER.id, name: LEDGER.name, color: LEDGER.color },
  { kind: "group", id: GROUP.id, name: GROUP.name, subtitle: "Chief, Scout" },
  { kind: "routine", id: "routine-1", name: "Morning brief", subtitle: "Every day at 8:00" },
  { kind: "connector", id: "connector-1", name: "Example Docs" },
];

const agentSkills: AgentSkillCatalogEntry[] = [
  {
    id: "skill-1",
    name: "summarize",
    description: "Summarize a document",
    source: "user",
    readOnly: false,
  },
  {
    id: "skill-2",
    name: "weekly-report",
    description: "Send a summary of the week every Friday",
    source: "user",
    readOnly: false,
  },
];

const DRAFT = "Ask @Scout for three venues near the office";

const draft =
  (key: string, text: string, mentions: ComposerMention[] = []) =>
  () => {
    writeComposerDraft(
      key,
      text,
      undefined,
      mentions.map((mention) => {
        const start = text.indexOf(`@${mention.name}`);
        return { start, end: start + mention.name.length + 1, mention };
      }),
    );
  };

const file = (name: string, type: string) => new File(["example"], name, { type });
const PREVIEW = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="silver"/><circle cx="12" cy="14" r="6" fill="gray"/></svg>',
)}`;

const meta = {
  title: "Chat/Composer",
  component: Composer,
  args: {
    draftKey: "story:empty",
    enterToSend: true,
    artifactTarget: { botId: CHIEF.id },
    activeName: CHIEF.name,
    running: false,
    sending: false,
    pendingAttachments: [],
    attachmentNotice: null,
    sendError: null,
    runError: null,
    runErrorId: null,
    fileInputRef: createRef(),
    mentionTargets,
    agentSkills,
    onSend: fn(async () => true),
    onStop: fn(async () => {}),
    onOpenModels: fn(),
    onOpenConnections: fn(),
    onRunErrorPresented: fn(),
    onDismissError: fn(),
    onAttachmentPick: fn(() => true),
    onRemoveAttachment: fn(),
    onClearReply: fn(),
    onSlashOpen: fn(),
    onSlashAction: fn(),
    onDraftEdited: fn(),
  },
  argTypes: { fileInputRef: { table: { disable: true } } },
  decorators: [
    (Story) => (
      <div className="flex h-dvh flex-col justify-end bg-background">
        <Story />
      </div>
    ),
  ],
  beforeEach: () => {
    clearComposerDrafts();
  },
} satisfies Meta<typeof Composer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const DraftWithMention: Story = {
  args: { draftKey: "story:draft" },
  beforeEach: draft("story:draft", DRAFT, [scout]),
};

export const MentionPicker: Story = {
  args: { draftKey: "story:mention" },
  beforeEach: draft("story:mention", "Ask @"),
};

export const SlashMenu: Story = {
  args: { draftKey: "story:slash" },
  beforeEach: draft("story:slash", "/"),
};

export const Replying: Story = {
  args: {
    replyTarget: say(
      "bot",
      "Sure. Here's the plan: pull revenue and churn, draft the summary, send it for review.",
    ),
    replyQuote: "draft the summary",
    replyTargetName: CHIEF.name,
  },
};

export const Attachments: Story = {
  args: {
    pendingAttachments: [
      {
        id: "attachment-1",
        threadKey: "bot:bot-1",
        file: file("q3-report.pdf", "application/pdf"),
      },
      {
        id: "attachment-2",
        threadKey: "bot:bot-1",
        file: file("whiteboard.svg", "image/svg+xml"),
        previewUrl: PREVIEW,
      },
    ],
    attachmentNotice: "Skipped recording.mov (over 25 MB)",
  },
};

export const Running: Story = { args: { running: true } };

export const RunFailed: Story = {
  args: { runError: '429: {"message":"Too many requests"}', runErrorId: "run-1" },
};

export const WithVoice: Story = {
  args: { phoneCallsEnabled: true, dictationTranscribe: true },
};

export const Disabled: Story = { args: { disabled: true } };
