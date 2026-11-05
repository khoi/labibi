import type { SharedPage } from "@labradoodle/contracts";
import { SHARED_PAGE_PATH_PREFIX } from "@labradoodle/contracts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Route, Routes } from "react-router-dom";
import { NOW } from "../storybook/fixtures";
import { PAGE_CODE } from "../storybook/pages";
import { SharedPagePage } from "./SharedPage";

const TOKEN = "k3J9xQm2Lr7VtB4nWp8YcD1fHs6GzA0eUo5iNq-Ty_E";
const SHARED_PATH = `${SHARED_PAGE_PATH_PREFIX}${TOKEN}`;

const PAGE: SharedPage = { title: "Q3 plan", code: PAGE_CODE, version: 1, updatedAt: NOW };

const meta = {
  title: "Views/Shared page",
  component: SharedPagePage,
  parameters: {
    route: `/p/q3-plan-${TOKEN}`,
    http: { "/api/auth/get-session": null, [SHARED_PATH]: PAGE },
  },
  render: () => (
    <Routes>
      <Route path="/p/:slugToken" element={<SharedPagePage />} />
    </Routes>
  ),
} satisfies Meta<typeof SharedPagePage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Shared: Story = {};

export const Unavailable: Story = { parameters: { http: { [SHARED_PATH]: null } } };

export const LoadFailed: Story = {
  parameters: {
    http: {
      [SHARED_PATH]: () => {
        throw new TypeError("Failed to fetch");
      },
    },
  },
};
