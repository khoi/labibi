import type { Space } from "@labradoodle/contracts";
import { ORPCError } from "@orpc/server";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn, screen } from "storybook/test";
import { api } from "../../storybook/api";
import { BOTS, GROUP, SPACE, SPACE_ID } from "../../storybook/fixtures";
import { AvailabilityControl, AvailabilityLabel } from "./space-availability";

const WORK: Space = { ...SPACE, id: "space-2", name: "Work", isDefault: false, canDelete: true };
const FAMILY: Space = {
  ...SPACE,
  id: "space-3",
  name: "Family",
  isDefault: false,
  canDelete: true,
};

const meta = {
  title: "Integrations/Space availability",
  component: AvailabilityControl,
  parameters: {
    layout: "centered",
    api: api({
      spaces: {
        list: {
          current: {
            id: SPACE_ID,
            name: SPACE.name,
            bots: BOTS,
            groups: [GROUP],
            externalConversations: [],
            botSections: [],
          },
          spaces: [SPACE, WORK, FAMILY],
        },
      },
      availability: { set: ({ allSpaces, spaceIds }) => ({ allSpaces, spaceIds }) },
    }),
  },
  args: {
    kind: "install",
    id: "install-1",
    availability: { allSpaces: true, spaceIds: [SPACE_ID] },
    onChanged: fn(),
  },
} satisfies Meta<typeof AvailabilityControl>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllSpaces: Story = {};

export const OneSpace: Story = {
  args: { availability: { allSpaces: false, spaceIds: [SPACE_ID] } },
};

export const SomeSpaces: Story = {
  args: { availability: { allSpaces: false, spaceIds: [SPACE_ID, WORK.id] } },
};

export const MenuOpen: Story = {
  args: { availability: { allSpaces: false, spaceIds: [SPACE_ID, WORK.id] } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button"));
  },
};

export const SaveFailed: Story = {
  args: { availability: { allSpaces: false, spaceIds: [SPACE_ID, WORK.id] } },
  parameters: {
    api: api({
      availability: {
        set: () => {
          throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Could not save" });
        },
      },
    }),
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button"));
    await userEvent.click(await screen.findByRole("menuitemcheckbox", { name: FAMILY.name }));
  },
};

export const Label: Story = {
  args: { availability: { allSpaces: false, spaceIds: [SPACE_ID, WORK.id] } },
  render: (args) => (
    <div className="flex flex-col items-start gap-2">
      <AvailabilityLabel availability={args.availability} />
      <AvailabilityLabel availability={{ allSpaces: false, spaceIds: [WORK.id] }} />
    </div>
  ),
};
