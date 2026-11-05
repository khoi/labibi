import type { Meta, StoryObj } from "@storybook/react-vite";
import { PlusIcon, SettingsIcon, UsersIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { useState } from "react";
import { Button } from "./button.js";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "./command.js";
import { Kbd } from "./kbd.js";

const bots = [
  { id: "chief", name: "Chief", role: "Runs the team" },
  { id: "scout", name: "Scout", role: "Finds sources" },
  { id: "ledger", name: "Ledger", role: "Keeps the books" },
];

function Items() {
  return (
    <>
      <CommandEmpty>No results</CommandEmpty>
      <CommandGroup heading="Bots">
        {bots.map((bot, index) => (
          <CommandItem key={bot.id} value={bot.name}>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{bot.name}</div>
              <div className="truncate text-xs text-muted-foreground">{bot.role}</div>
            </div>
            <CommandShortcut className="tracking-normal">
              <Kbd>⌘{index + 1}</Kbd>
            </CommandShortcut>
          </CommandItem>
        ))}
      </CommandGroup>
      <CommandSeparator />
      <CommandGroup heading="Actions">
        <CommandItem value="New bot">
          <PlusIcon />
          New bot
        </CommandItem>
        <CommandItem value="New group">
          <UsersIcon />
          New group
        </CommandItem>
        <CommandItem value="Show archived bots" data-checked="true">
          Show archived bots
        </CommandItem>
        <CommandItem value="Settings" disabled>
          <SettingsIcon />
          Settings
        </CommandItem>
      </CommandGroup>
    </>
  );
}

const meta = {
  title: "Primitives/Command",
  component: Command,
  parameters: { layout: "centered" },
  args: { label: "Command menu" },
} satisfies Meta<typeof Command>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Inline: Story = {
  render: (args) => (
    <Command {...args} className="w-96 ring-1 ring-foreground/10">
      <CommandInput placeholder="Search bots, actions, and settings" />
      <CommandList>
        <Items />
      </CommandList>
    </Command>
  ),
};

function Searched(props: ComponentProps<typeof Command>) {
  const [search, setSearch] = useState("quarterly invoices");
  return (
    <Command {...props} className="w-96 ring-1 ring-foreground/10">
      <CommandInput placeholder="Search" value={search} onValueChange={setSearch} />
      <CommandList>
        <Items />
      </CommandList>
    </Command>
  );
}

export const NoResults: Story = { render: (args) => <Searched {...args} /> };

function PaletteDialog({ initiallyOpen }: { initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Search <Kbd>⌘K</Kbd>
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Command menu"
        description="Search bots, actions, and settings"
        className="sm:max-w-xl"
      >
        <Command className="rounded-xl! bg-popover">
          <CommandInput placeholder="Search" />
          <CommandList className="max-h-80">
            <Items />
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}

export const InDialog: Story = { render: () => <PaletteDialog initiallyOpen /> };

export const DialogClosed: Story = { render: () => <PaletteDialog initiallyOpen={false} /> };
