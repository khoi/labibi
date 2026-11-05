import {
  MISSING_MODEL_RUN_ERROR,
  MODEL_IMAGE_INPUT_UNKNOWN,
  MODEL_REQUIRED_SEND_ERROR,
} from "@labradoodle/core";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { createRef } from "react";
import { fn } from "storybook/test";
import { ComposerError } from "./composer-error";

const meta = {
  title: "Chat/Composer error",
  component: ComposerError,
  parameters: { layout: "padded" },
  args: {
    sendError: "Could not send the message.",
    runError: null,
    runErrorId: null,
    onRunErrorPresented: fn(),
    onOpenModels: fn(),
    onOpenConnections: fn(),
    onDismissError: fn(),
    textareaRef: createRef(),
  },
} satisfies Meta<typeof ComposerError>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SendFailed: Story = {};

export const ModelRequired: Story = { args: { sendError: MODEL_REQUIRED_SEND_ERROR } };

export const ImageNeedsConfirmation: Story = {
  args: { sendError: MODEL_IMAGE_INPUT_UNKNOWN, imageConfirmation: true, onSendAsFile: fn() },
};

export const RateLimited: Story = {
  args: {
    sendError: null,
    runError: '429: {"message":"Too many requests"}',
    runErrorId: "run-1",
  },
};

export const InvalidKey: Story = {
  args: { sendError: null, runError: '401: {"message":"Invalid API key"}', runErrorId: "run-2" },
};

export const OutOfCredits: Story = {
  args: {
    sendError: null,
    runError: '402: {"message":"You have no credits remaining."}',
    runErrorId: "run-3",
  },
};

export const NoModelConnected: Story = {
  args: { sendError: null, runError: MISSING_MODEL_RUN_ERROR, runErrorId: "run-4" },
};
