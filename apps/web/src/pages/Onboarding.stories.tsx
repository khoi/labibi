import type { ModelCatalogEntry } from "@labradoodle/contracts";
import { OPENAI_COMPATIBLE_PROVIDER_ID } from "@labradoodle/contracts";
import { ORPCError } from "@orpc/server";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Route, Routes } from "react-router-dom";
import { within } from "storybook/test";
import { api } from "../storybook/api";
import { ME } from "../storybook/fixtures";
import { OnboardingPage } from "./Onboarding";

const CATALOG: ModelCatalogEntry[] = [
  {
    provider: "example",
    providerName: "Example AI",
    id: "example-large",
    label: "Example Large",
    billing: "API key",
    auth: "api-key",
    recommended: true,
    catalogProbe: true,
  },
  {
    provider: "example",
    providerName: "Example AI",
    id: "example-small",
    label: "Example Small",
    billing: "API key",
    auth: "api-key",
  },
  {
    provider: "example-cloud",
    providerName: "Example Cloud",
    id: "example-cloud-pro",
    label: "Example Cloud Pro",
    billing: "Subscription",
    auth: "both",
    signIn: "device-code",
    oauthLabel: "Sign in with Example Cloud",
  },
  {
    provider: OPENAI_COMPATIBLE_PROVIDER_ID,
    providerName: "Custom server",
    id: "",
    label: "Custom",
    billing: "API key",
  },
];

const needsModel = api({
  me: { ...ME, needsModel: true },
  models: { list: CATALOG },
});

const meta = {
  title: "Views/Onboarding",
  component: OnboardingPage,
  parameters: { route: "/onboarding/model", api: needsModel },
  render: () => (
    <Routes>
      <Route path="/onboarding/:step?" element={<OnboardingPage />} />
    </Routes>
  ),
} satisfies Meta<typeof OnboardingPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Survey: Story = {
  parameters: {
    route: "/onboarding",
    api: api({
      me: { ...ME, needsModel: true, needsSignupSurvey: true },
      onboarding: { signupSurvey: { ok: true } },
    }),
  },
};

export const ConnectModel: Story = {};

export const ApiKey: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("combobox", { name: "Provider" }));
    await userEvent.click(await within(document.body).findByRole("option", { name: "Example AI" }));
    await userEvent.type(await canvas.findByLabelText("API key"), "story-key-0000");
  },
};

export const SubscriptionSignIn: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("combobox", { name: "Provider" }));
    await userEvent.click(
      await within(document.body).findByRole("option", { name: "Example Cloud" }),
    );
  },
};

export const CustomServer: Story = {
  parameters: {
    api: api({
      models: { probeOpenAiCompatible: { models: ["example-local-8b", "example-local-70b"] } },
    }),
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("combobox", { name: "Provider" }));
    await userEvent.click(
      await within(document.body).findByRole("option", { name: "Custom server" }),
    );
    await userEvent.type(
      await canvas.findByRole("textbox", { name: "OpenAI-compatible server URL" }),
      "http://127.0.0.1:8000/v1",
    );
    await userEvent.click(canvas.getByRole("button", { name: "Find models" }));
  },
};

export const WithCredits: Story = {
  parameters: { api: api({ me: { ...ME, needsModel: true, billingEnabled: true } }) },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("combobox", { name: "Provider" }));
    await userEvent.click(
      await within(document.body).findByRole("option", { name: "Labradoodle credits" }),
    );
  },
};

export const FirstBotFailed: Story = {
  parameters: {
    route: "/onboarding",
    api: api({
      me: ME,
      bots: {
        list: () => {
          throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "The server is busy." });
        },
      },
    }),
  },
};
