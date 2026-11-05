import type { SpaceInvitePreview } from "@labradoodle/contracts";
import { ORPCError } from "@orpc/server";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { App } from "../App";
import { api } from "../storybook/api";
import { SPACE_ID } from "../storybook/fixtures";
import { InvitePage } from "./Invite";

const PREVIEW: SpaceInvitePreview = {
  spaceId: "space-2",
  spaceName: "Support",
  inviterName: "Noor Haddad",
  alreadyMember: false,
};

const fail = (code: string) => () => {
  throw new ORPCError(code);
};

const meta = {
  title: "Views/Invite",
  component: InvitePage,
  parameters: {
    route: "/invite/story-invite-token",
    api: api({ spaces: { invites: { preview: PREVIEW, accept: { spaceId: PREVIEW.spaceId } } } }),
  },
  render: () => <App />,
} satisfies Meta<typeof InvitePage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SignedIn: Story = {};

export const SignedOut: Story = {
  parameters: { http: { "/api/auth/get-session": null } },
};

export const NoLongerValid: Story = {
  parameters: {
    api: api({
      spaces: { invites: { preview: fail("NOT_FOUND") } },
    }),
  },
};

export const AlreadyMember: Story = {
  parameters: {
    api: api({
      spaces: { invites: { preview: { ...PREVIEW, spaceId: SPACE_ID, alreadyMember: true } } },
    }),
  },
};

export const LoadFailed: Story = {
  parameters: {
    api: api({
      spaces: { invites: { preview: fail("SERVICE_UNAVAILABLE") } },
    }),
  },
};

export const JoinFailed: Story = {
  parameters: {
    api: api({
      spaces: { invites: { accept: fail("SERVICE_UNAVAILABLE") } },
    }),
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Join" }));
    await canvas.findByRole("alert");
  },
};
