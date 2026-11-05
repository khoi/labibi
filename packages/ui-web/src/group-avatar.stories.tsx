import type { LogoAvatarActivity } from "@labradoodle/core";
import { BOT_COLOR_LIST, logoAvatarStatusActivity } from "@labradoodle/core";
import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { BotAvatarActivityProvider } from "./bot-avatar-activity.js";
import type { GroupAvatarMember, GroupAvatarProps } from "./group-avatar.js";
import { GroupAvatar } from "./group-avatar.js";

const activities = [
  "idle",
  "thinking",
  "reading",
  "writing",
  "computer",
  "working",
  "waiting",
  "error",
] as const satisfies readonly LogoAvatarActivity[];
const names = ["Chief", "Scout", "Ledger", "Atlas", "Quill", "Nova", "Pip"];
const members: GroupAvatarMember[] = BOT_COLOR_LIST.map((color, index) => ({
  botId: `bot-${index + 1}`,
  name: names[index],
  color: color.hex,
}));

type Args = GroupAvatarProps & { activity?: LogoAvatarActivity };

const withActivity: Decorator<Args> = (Story, { args }) => (
  <BotAvatarActivityProvider
    source={{
      subscribe: () => () => {},
      getActivity: (_id, status) => args.activity ?? logoAvatarStatusActivity(status),
    }}
  >
    <Story />
  </BotAvatarActivityProvider>
);

const meta = {
  title: "Avatars/Group avatar",
  component: GroupAvatar,
  parameters: { layout: "centered" },
  args: { members: members.slice(0, 2), size: 64 },
  argTypes: {
    activity: { control: "select", options: activities },
    size: { control: { type: "range", min: 20, max: 120, step: 2 } },
  },
  decorators: [withActivity],
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = { args: { members: [] } };

export const Solo: Story = { args: { members: members.slice(0, 1) } };

export const Pair: Story = {};

export const Trio: Story = { args: { members: members.slice(0, 3) } };

export const Overflow: Story = { args: { members } };

export const Working: Story = {
  args: {
    members: [
      { ...members[0]!, status: "running" },
      members[1]!,
      { ...members[2]!, status: "failed" },
    ],
  },
};

export const Sizes: Story = {
  args: { members: members.slice(0, 3) },
  render: (args) => (
    <div className="flex items-end gap-6">
      {[26, 28, 38, 40, 52].map((size) => (
        <div key={size} className="flex flex-col items-center gap-2">
          <GroupAvatar {...args} size={size} />
          <span className="text-xs text-muted-foreground tabular-nums">{size}</span>
        </div>
      ))}
    </div>
  ),
};
