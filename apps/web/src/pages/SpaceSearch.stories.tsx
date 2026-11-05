import type { SearchHit } from "@labradoodle/contracts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { CHIEF, GROUP, SCOUT } from "../storybook/fixtures";
import { SpaceSearchResults } from "./SpaceSearch";

const hits: SearchHit[] = [
  {
    kind: "conversation",
    botId: CHIEF.id,
    botName: CHIEF.name,
    title: CHIEF.name,
    snippet: "Got it, one paragraph.",
  },
  {
    kind: "conversation",
    groupId: GROUP.id,
    groupName: GROUP.name,
    title: GROUP.name,
    snippet: "Scout: the launch post is drafted.",
  },
  {
    kind: "message",
    botId: CHIEF.id,
    botName: CHIEF.name,
    title: "Q3 report",
    snippet: "Pull revenue and churn from the finance sheet, then draft the summary.",
    messageId: "message-2",
    seq: 2,
  },
  {
    kind: "file",
    botId: SCOUT.id,
    botName: SCOUT.name,
    title: "churn-sources.pdf",
    snippet: "application/pdf, 240 KB",
    messageId: "message-7",
    seq: 7,
    artifactId: "artifact-1",
  },
  {
    kind: "link",
    groupId: GROUP.id,
    groupName: GROUP.name,
    title: "Launch checklist",
    snippet: "example.test/launch",
    url: "https://example.test/launch",
  },
  {
    kind: "routine",
    botId: CHIEF.id,
    botName: CHIEF.name,
    title: "Morning digest",
    snippet: "Every weekday at 9:00 AM",
    routineId: "routine-1",
  },
];

const meta = {
  title: "Panels/Space search",
  component: SpaceSearchResults,
  parameters: { layout: "padded" },
  args: { hits, loading: false, error: null, onRetry: fn(), onSelect: fn() },
  decorators: [
    (Story) => (
      <div className="w-[300px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SpaceSearchResults>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Results: Story = {};

export const Loading: Story = { args: { loading: true } };

export const NoResults: Story = { args: { hits: [] } };

export const Failed: Story = { args: { error: "Could not search this space" } };
