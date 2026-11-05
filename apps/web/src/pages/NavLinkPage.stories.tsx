import type { Meta, StoryObj } from "@storybook/react-vite";
import { Route, Routes } from "react-router-dom";
import { api } from "../storybook/api";
import { ME } from "../storybook/fixtures";
import { NavLinkPage } from "./NavLinkPage";

const meta = {
  title: "Views/Nav link",
  component: NavLinkPage,
  parameters: {
    route: "/app/x/team-status",
    api: api({
      me: {
        ...ME,
        navLinks: [
          { id: "team-status", label: "Team status", path: "/favicon-32x32.png", trusted: false },
        ],
      },
    }),
  },
  render: () => (
    <Routes>
      <Route path="/app/x/:linkId" element={<NavLinkPage />} />
    </Routes>
  ),
} satisfies Meta<typeof NavLinkPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
