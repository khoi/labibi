import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import type { ExternalToast, ToasterProps } from "sonner";
import { Button } from "./button.js";
import { Toaster, toast } from "./sonner.js";

const TOASTER_ID = "primitives-sonner";

type Demo = { id: string; show: (options: ExternalToast) => void };

function show(demos: readonly Demo[]) {
  for (const demo of demos) {
    demo.show({ id: demo.id, toasterId: TOASTER_ID, duration: Number.POSITIVE_INFINITY });
  }
}

function Toasts({ demos, ...props }: ToasterProps & { demos: readonly Demo[] }) {
  useEffect(() => {
    show(demos);
    return () => {
      for (const demo of demos) toast.dismiss(demo.id);
    };
  }, [demos]);
  return (
    <>
      <Button variant="outline" onClick={() => show(demos)}>
        Show toast
      </Button>
      <Toaster {...props} id={TOASTER_ID} />
    </>
  );
}

const saved: Demo = { id: "saved", show: (options) => toast.success("Settings saved", options) };
const failed: Demo = {
  id: "failed",
  show: (options) =>
    toast.error("Couldn't reach Example AI", {
      ...options,
      description: "Check the connection's address and key, then try again.",
    }),
};
const archived: Demo = {
  id: "archived",
  show: (options) =>
    toast("Scout archived", { ...options, action: { label: "Undo", onClick: () => {} } }),
};
const connecting: Demo = {
  id: "connecting",
  show: (options) => toast.loading("Connecting to example-large…", options),
};
const info: Demo = {
  id: "info",
  show: (options) => toast.info("Ledger is working in the background", options),
};
const warning: Demo = {
  id: "warning",
  show: (options) => toast.warning("You've used 90% of this month's messages", options),
};

const successDemos = [saved];
const errorDemos = [failed];
const actionDemos = [archived];
const loadingDemos = [connecting];
const stackedDemos = [info, warning, saved];

const meta = {
  title: "Primitives/Sonner",
  component: Toaster,
  parameters: { layout: "padded" },
  args: { position: "bottom-right" },
  argTypes: {
    position: {
      control: "select",
      options: [
        "top-left",
        "top-center",
        "top-right",
        "bottom-left",
        "bottom-center",
        "bottom-right",
      ],
    },
    expand: { control: "boolean" },
    richColors: { control: "boolean" },
    closeButton: { control: "boolean" },
  },
} satisfies Meta<typeof Toaster>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = { render: (args) => <Toasts {...args} demos={successDemos} /> };

export const ErrorWithDescription: Story = {
  render: (args) => <Toasts {...args} demos={errorDemos} />,
};

export const WithAction: Story = { render: (args) => <Toasts {...args} demos={actionDemos} /> };

export const Loading: Story = { render: (args) => <Toasts {...args} demos={loadingDemos} /> };

export const Stacked: Story = {
  args: { expand: true },
  render: (args) => <Toasts {...args} demos={stackedDemos} />,
};
