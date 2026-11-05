import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ErrorBoundary, lazyOverlay, SectionLoadFailed } from "./ErrorBoundary";

const RENDER_FAILURE = new Error("Example render failure");
const LOAD_FAILURE = new Error("Example chunk failed to load");

function Broken(): never {
  throw RENDER_FAILURE;
}

const FailedOverlay = lazyOverlay<{ onClose: () => void }>(() => Promise.reject(LOAD_FAILURE));

const meta = {
  title: "Account/Error boundary",
  component: ErrorBoundary,
  parameters: { layout: "padded" },
  args: {
    children: <p className="text-sm">The section loaded.</p>,
    fallback: <SectionLoadFailed />,
  },
  beforeEach: () => {
    const log = console.error;
    console.error = (...args: unknown[]) => {
      if (!args.includes(RENDER_FAILURE) && !args.includes(LOAD_FAILURE)) log(...args);
    };
    return () => {
      console.error = log;
    };
  },
} satisfies Meta<typeof ErrorBoundary>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Working: Story = {};

export const SectionFailed: Story = {
  args: { children: <Broken /> },
};

export const OverlayFailed: Story = {
  render: () => (
    <div className="min-h-screen">
      <FailedOverlay onClose={fn()} />
    </div>
  ),
};
