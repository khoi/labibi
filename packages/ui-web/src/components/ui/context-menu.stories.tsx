import type { Meta, StoryObj } from "@storybook/react-vite";
import { MessageSquareIcon, PencilIcon, Trash2Icon } from "lucide-react";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "./context-menu.js";

const meta = {
  title: "Primitives/Context menu",
  component: ContextMenu,
  parameters: { layout: "centered" },
} satisfies Meta<typeof ContextMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const BotActions: Story = {
  play: async ({ canvasElement }) => {
    const trigger = canvasElement.querySelector("[data-slot=context-menu-trigger]");
    if (!trigger) return;
    const box = trigger.getBoundingClientRect();
    trigger.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: box.left + box.width / 2,
        clientY: box.top + box.height / 2,
      }),
    );
  },
  render: (args) => (
    <ContextMenu {...args}>
      <ContextMenuTrigger className="flex h-32 w-72 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        Right-click Scout
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuGroup>
          <ContextMenuLabel>Scout</ContextMenuLabel>
          <ContextMenuItem>
            <MessageSquareIcon />
            Open chat
          </ContextMenuItem>
          <ContextMenuItem>
            <PencilIcon />
            Rename
            <ContextMenuShortcut>⌘R</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuCheckboxItem defaultChecked>Pin to top</ContextMenuCheckboxItem>
        </ContextMenuGroup>
        <ContextMenuSub>
          <ContextMenuSubTrigger>Move to group</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem>Research</ContextMenuItem>
            <ContextMenuItem>Finance</ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuLabel>Notifications</ContextMenuLabel>
          <ContextMenuRadioGroup defaultValue="mentions">
            <ContextMenuRadioItem value="all">All messages</ContextMenuRadioItem>
            <ContextMenuRadioItem value="mentions">Mentions only</ContextMenuRadioItem>
            <ContextMenuRadioItem value="none">Off</ContextMenuRadioItem>
          </ContextMenuRadioGroup>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive">
          <Trash2Icon />
          Delete bot
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  ),
};

export const Closed: Story = { render: BotActions.render };
