import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { api } from "../../storybook/api";
import { CHIEF, NOW, say } from "../../storybook/fixtures";
import { ComposerReplyPreview, ReplyLine, TimeSeparator, UnreadDivider } from "./chat-context";

const IMAGE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="silver"/><circle cx="24" cy="30" r="12" fill="gray"/></svg>';

const photo = {
  kind: "image" as const,
  artifactId: "image-1",
  mimeType: "image/svg+xml",
  name: "whiteboard.svg",
};

const meta = {
  title: "Chat/Chat context",
  component: TimeSeparator,
  parameters: { layout: "padded" },
  args: { createdAt: NOW, locale: "en" },
} satisfies Meta<typeof TimeSeparator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Separator: Story = {};

export const SeparatorToday: Story = { args: { createdAt: new Date().toISOString() } };

export const NewMessages: Story = {
  render: () => <UnreadDivider />,
};

export const ReplyingTo: Story = {
  render: () => (
    <ComposerReplyPreview
      author="Chief"
      text="Sure. Here's the plan: pull revenue and churn, draft the summary, send it for review."
      onDismiss={fn()}
    />
  ),
};

export const ReplyingToQuote: Story = {
  render: () => (
    <ComposerReplyPreview
      author="Chief"
      text="Sure. Here's the plan: pull revenue and churn, draft the summary, send it for review."
      quote="draft the summary"
      onDismiss={fn()}
    />
  ),
};

export const ReplyingToPhoto: Story = {
  parameters: {
    api: api({
      artifacts: {
        get: (input) => ({
          id: input.artifactId,
          botId: CHIEF.id,
          groupId: null,
          runId: null,
          name: photo.name,
          description: null,
          mimeType: photo.mimeType,
          size: IMAGE_SVG.length,
          version: 1,
          createdAt: NOW,
          contentBase64: btoa(IMAGE_SVG),
        }),
      },
    }),
  },
  render: () => (
    <ComposerReplyPreview
      author="You"
      text=""
      attachment={photo}
      target={{ botId: CHIEF.id }}
      onDismiss={fn()}
    />
  ),
};

export const RepliedLine: Story = {
  render: () => (
    <ReplyLine
      author="Chief"
      message={say("user", "Keep the summary short.", {
        replyToMessageId: "message-parent",
        replyQuote: "Draft the summary",
        replyPreview: { role: "bot", botId: CHIEF.id, text: "Draft the summary" },
      })}
      onJump={fn()}
    />
  ),
};

export const RepliedLineUnavailable: Story = {
  render: () => (
    <ReplyLine
      author="Chief"
      message={say("user", "Keep the summary short.", {
        replyToMessageId: "message-parent",
        replyPreview: null,
      })}
    />
  ),
};
