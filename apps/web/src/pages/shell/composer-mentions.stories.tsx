import type { ComposerMention } from "@labradoodle/core";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "lucide-react";
import { fn } from "storybook/test";
import { CHIEF, GROUP, SCOUT } from "../../storybook/fixtures";
import { ComposerChip, ComposerMentionHighlights, MentionOptionIcon } from "./composer-mentions";

const scout: ComposerMention = { kind: "bot", id: SCOUT.id, name: SCOUT.name, color: SCOUT.color };
const chief: ComposerMention = { kind: "bot", id: CHIEF.id, name: CHIEF.name, color: CHIEF.color };
const team: ComposerMention = { kind: "group", id: GROUP.id, name: "Launch team" };
const routine: ComposerMention = { kind: "routine", id: "routine-1", name: "Morning brief" };
const docs: ComposerMention = { kind: "connector", id: "connector-1", name: "Example Docs" };
const everyone: ComposerMention = { kind: "everyone", id: "everyone", name: "everyone" };

const TEXT = "Ask @Scout for venues, then run @Morning brief and tell @Launch team.";
const bind = (mention: ComposerMention) => {
  const start = TEXT.indexOf(`@${mention.name}`);
  return { start, end: start + mention.name.length + 1, mention };
};

const meta = {
  title: "Chat/Composer mentions",
  component: ComposerMentionHighlights,
  parameters: { layout: "padded" },
  args: {
    ref: null,
    text: TEXT,
    bindings: [bind(scout), bind(routine), bind(team)],
    targets: [scout, chief, team],
    className: "max-w-xl whitespace-pre-wrap break-words text-body1 text-foreground",
  },
} satisfies Meta<typeof ComposerMentionHighlights>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Highlights: Story = {};

export const PlainText: Story = { args: { bindings: [] } };

export const OptionIcons: Story = {
  render: () => (
    <ul className="flex flex-col gap-2 text-[14px] text-foreground">
      {[scout, chief, team, routine, docs, everyone].map((mention) => (
        <li key={mention.id} className="flex items-center gap-3">
          <MentionOptionIcon mention={mention} />@{mention.name}
        </li>
      ))}
    </ul>
  ),
};

export const SkillChip: Story = {
  render: () => (
    <ComposerChip
      icon={<Box size={13} strokeWidth={1.7} className="shrink-0 text-muted-foreground/70" />}
      label="summarize"
      removeLabel="Remove skill summarize"
      onRemove={fn()}
    />
  ),
};
