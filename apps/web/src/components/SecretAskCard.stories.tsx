import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import type { AskBlock } from "./AskCard";
import { SecretAskCard } from "./SecretAskCard";

const code: AskBlock = {
  kind: "ask",
  text: "Enter the code the shop texted you.",
  input: "secret",
  purpose: "otp",
  oneTimeCode: { origin: "https://shop.example.test" },
  detail: "It has 6 digits and expires in 10 minutes.",
  status: "pending",
};

const meta = {
  title: "Chat/Secret ask card",
  component: SecretAskCard,
  parameters: { layout: "padded" },
  args: {
    block: code,
    canAnswer: true,
    canDismiss: true,
    onAnswer: fn(),
    onDismiss: fn(),
  },
} satisfies Meta<typeof SecretAskCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OneTimeCode: Story = {};

export const ApiKey: Story = {
  args: {
    block: {
      kind: "ask",
      text: "I need an API key for the analytics service.",
      input: "secret",
      purpose: "api_key",
      credential: { name: "ANALYTICS_KEY", origin: "", auth: { type: "command" } },
      status: "pending",
    },
  },
};

export const Login: Story = {
  args: {
    block: {
      kind: "ask",
      text: "Sign in to the vendor portal.",
      input: "secret",
      purpose: "password",
      credential: {
        name: "vendor-portal",
        origin: "https://portal.example.test",
        auth: { type: "login" },
      },
      loginFields: ["ID number", "Phone number", "PIN"],
      status: "pending",
    },
  },
};

export const Saved: Story = {
  args: {
    block: {
      kind: "ask",
      text: "I need an API key for the analytics service.",
      input: "secret",
      purpose: "api_key",
      credential: { name: "ANALYTICS_KEY", origin: "", auth: { type: "command" } },
      status: "answered",
      answer: "",
    },
  },
};

export const Dismissed: Story = {
  args: { block: { ...code, status: "answered", answer: "", dismissed: true } },
};

export const NoLongerActive: Story = {
  args: { canAnswer: false },
};
