import { ORPCError } from "@orpc/server";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { api } from "../storybook/api";
import { CHIEF, NOW } from "../storybook/fixtures";
import { ArtifactFileCard } from "./ArtifactFileCard";

const SUMMARY = [
  "# Q3 summary",
  "",
  "Revenue grew **17%** to 1.4M while churn fell from 3.1% to 2.7%.",
  "",
  "| Metric | Q2 | Q3 |",
  "| --- | ---: | ---: |",
  "| Revenue | 1.2M | 1.4M |",
  "| Churn | 3.1% | 2.7% |",
  "",
  "## Next steps",
  "",
  "1. Share the summary with the team",
  "2. Plan the Q4 review",
].join("\n");

const ARTIFACT = {
  id: "artifact-1",
  botId: CHIEF.id,
  groupId: null,
  runId: null,
  name: "q3-summary.md",
  description: null,
  mimeType: "text/markdown",
  size: 18_432,
  version: 1,
  createdAt: NOW,
  contentBase64: btoa(SUMMARY),
};

const meta = {
  title: "Chat/Artifact file card",
  component: ArtifactFileCard,
  parameters: {
    layout: "padded",
    api: api({ artifacts: { get: ARTIFACT } }),
  },
  args: {
    target: { botId: CHIEF.id },
    artifactId: ARTIFACT.id,
    name: ARTIFACT.name,
    mimeType: ARTIFACT.mimeType,
    size: ARTIFACT.size,
  },
} satisfies Meta<typeof ArtifactFileCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Document: Story = {};

export const WebPage: Story = {
  args: { name: "launch-checklist.html", mimeType: "text/html", size: 6_210 },
};

export const DownloadOnly: Story = {
  args: { name: "q3-exports.zip", mimeType: "application/zip", size: 4_718_592 },
};

export const Audio: Story = {
  args: { name: "standup-notes.mp3", mimeType: "audio/mpeg", size: 1_258_291 },
};

export const Preview: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Preview q3-summary.md" }));
  },
};

export const PreviewFailed: Story = {
  parameters: {
    api: api({
      artifacts: {
        get: () => {
          throw new ORPCError("NOT_FOUND", { message: "This file was deleted." });
        },
      },
    }),
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Preview q3-summary.md" }));
  },
};
