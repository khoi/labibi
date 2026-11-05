import { BotAvatar, Button } from "@labradoodle/ui-web";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { PhoneOff } from "lucide-react";
import { CHIEF } from "../../storybook/fixtures";
import { CallWindow } from "./CallWindow";

const meta = {
  title: "Calls/Call window",
  component: CallWindow,
  args: {
    "data-testid": "call-window",
    role: "dialog",
    "aria-label": `Call with ${CHIEF.name}`,
    className:
      "fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background p-6 md:inset-auto md:end-4 md:top-16 md:w-[360px] md:rounded-[22px] md:border md:border-border md:bg-card md:shadow-lg",
    children: (
      <>
        <BotAvatar color={CHIEF.color} identity={CHIEF.id} size={96} />
        <span className="text-xl font-semibold text-foreground">{CHIEF.name}</span>
        <Button
          variant="destructive"
          size="icon-lg"
          className="size-12 rounded-full"
          aria-label="Hang up"
        >
          <PhoneOff className="size-5" />
        </Button>
      </>
    ),
  },
} satisfies Meta<typeof CallWindow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const BesideTheApp: Story = {};

export const FullScreenOnPhone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
