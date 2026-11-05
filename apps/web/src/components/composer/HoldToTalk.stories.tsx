import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import type { useHoldToTalk } from "./HoldToTalk";
import { HoldToTalkControls, HoldToTalkStrip } from "./HoldToTalk";

type Talk = ReturnType<typeof useHoldToTalk>;

const idle: Talk = {
  recording: null,
  transcribing: false,
  transcript: "",
  lift: 0,
  notice: null,
  submit: fn(),
  cancel: fn(),
  startHandsFree: fn(),
  buttonProps: {
    onPointerDown: fn(),
    onPointerMove: fn(),
    onPointerUp: fn(),
    onPointerCancel: fn(),
    onClick: fn(),
    onContextMenu: fn(),
  },
};

const startedAt = Date.now() - 4_000;

const meta = {
  title: "Calls/Hold to talk",
  component: HoldToTalkControls,
  parameters: { layout: "centered" },
  args: { talk: idle, disabled: false },
  render: (args) => (
    <div className="mt-16 flex w-[420px] items-center gap-2 rounded-[22px] border border-border bg-card px-3 py-2">
      {args.talk.recording ? (
        <HoldToTalkStrip talk={args.talk} />
      ) : (
        <span className="flex-1 text-sm text-muted-foreground">Message Chief</span>
      )}
      <HoldToTalkControls {...args} />
    </div>
  ),
} satisfies Meta<typeof HoldToTalkControls>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {};

export const Holding: Story = {
  args: {
    talk: {
      ...idle,
      recording: { locked: false, startedAt },
      lift: 24,
      transcript: "Book the Loft for",
    },
  },
};

export const Locked: Story = {
  args: {
    talk: {
      ...idle,
      recording: { locked: true, startedAt },
      transcript: "Book the Loft for Tuesday at 2 pm and tell the team",
    },
  },
};

export const Transcribing: Story = {
  args: {
    talk: { ...idle, recording: { locked: true, startedAt }, transcribing: true },
  },
};

export const TapHint: Story = {
  args: { talk: { ...idle, notice: "Hold to talk, release to send" } },
};

export const Disabled: Story = { args: { disabled: true } };
