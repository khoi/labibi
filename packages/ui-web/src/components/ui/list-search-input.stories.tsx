import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { useState } from "react";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "./command.js";
import { ListSearchInput } from "./list-search-input.js";

const models = ["example-large", "example-small", "example-vision", "local-7b", "local-13b"];

type Props = ComponentProps<typeof ListSearchInput>;

function Search(props: Props) {
  const [query, setQuery] = useState(props.query);
  return (
    <div className="w-72">
      <ListSearchInput {...props} query={query} setQuery={setQuery} />
    </div>
  );
}

function ModelPicker(props: Props) {
  const [query, setQuery] = useState(props.query);
  const visible = models.filter((model) => model.includes(query.trim().toLowerCase()));
  return (
    <Command label="Search models" shouldFilter={false} className="w-72 ring-1 ring-foreground/10">
      <ListSearchInput {...props} command query={query} setQuery={setQuery} />
      <CommandList>
        <CommandEmpty>No models match</CommandEmpty>
        <CommandGroup>
          {visible.map((model) => (
            <CommandItem key={model} value={model}>
              {model}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

const meta = {
  title: "Primitives/List search input",
  component: ListSearchInput,
  parameters: { layout: "centered" },
  args: { query: "", setQuery: () => {}, label: "Search models", placeholder: "Search" },
  argTypes: { setQuery: { table: { disable: true } }, inputRef: { table: { disable: true } } },
  render: (args) => <Search key={args.query} {...args} />,
} satisfies Meta<typeof ListSearchInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const WithQuery: Story = { args: { query: "example" } };

export const InCommandList: Story = {
  args: { query: "local" },
  render: (args) => <ModelPicker key={args.query} {...args} />,
};
