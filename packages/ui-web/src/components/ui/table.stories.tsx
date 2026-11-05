import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge } from "./badge.js";
import { Checkbox } from "./checkbox.js";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "./table.js";

const members = [
  { name: "Ada Park", email: "ada.park@example.test", role: "Owner", active: "Now" },
  { name: "Ben Ortiz", email: "ben.ortiz@example.test", role: "Admin", active: "2 hours ago" },
  { name: "Chloe Ng", email: "chloe.ng@example.test", role: "Member", active: "Yesterday" },
  { name: "Dev Rao", email: "dev.rao@example.test", role: "Member", active: "Invited" },
];

const usage = [
  { model: "example-large", messages: 812, tokens: "1.9M" },
  { model: "example-small", messages: 431, tokens: "0.4M" },
  { model: "local-7b", messages: 41, tokens: "0.1M" },
];

const meta = {
  title: "Primitives/Table",
  component: Table,
  parameters: { layout: "padded" },
} satisfies Meta<typeof Table>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Members: Story = {
  render: (args) => (
    <Table {...args}>
      <TableCaption>4 people in Research team</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Role</TableHead>
          <TableHead className="text-right">Last active</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((member) => (
          <TableRow key={member.email}>
            <TableCell className="font-medium">{member.name}</TableCell>
            <TableCell className="text-muted-foreground">{member.email}</TableCell>
            <TableCell>
              <Badge variant={member.role === "Owner" ? "default" : "secondary"}>
                {member.role}
              </Badge>
            </TableCell>
            <TableCell className="text-right text-muted-foreground">{member.active}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ),
};

export const WithFooter: Story = {
  render: (args) => (
    <Table {...args}>
      <TableHeader>
        <TableRow>
          <TableHead>Model</TableHead>
          <TableHead className="text-right">Messages</TableHead>
          <TableHead className="text-right">Tokens</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {usage.map((row) => (
          <TableRow key={row.model}>
            <TableCell>{row.model}</TableCell>
            <TableCell className="text-right tabular-nums">{row.messages}</TableCell>
            <TableCell className="text-right tabular-nums">{row.tokens}</TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell>This month</TableCell>
          <TableCell className="text-right tabular-nums">1,284</TableCell>
          <TableCell className="text-right tabular-nums">2.4M</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  ),
};

export const Selectable: Story = {
  render: (args) => (
    <Table {...args}>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8">
            <Checkbox aria-label="Select all" indeterminate />
          </TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Role</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((member, index) => (
          <TableRow key={member.email} data-state={index === 1 ? "selected" : undefined}>
            <TableCell>
              <Checkbox aria-label={`Select ${member.name}`} defaultChecked={index === 1} />
            </TableCell>
            <TableCell>{member.name}</TableCell>
            <TableCell>{member.role}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ),
};

export const Empty: Story = {
  render: (args) => (
    <Table {...args}>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Role</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell colSpan={3} className="h-24 text-center text-muted-foreground">
            No one has been invited yet
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  ),
};
