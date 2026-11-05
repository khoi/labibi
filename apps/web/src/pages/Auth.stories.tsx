import type { AuthCapabilities } from "@labradoodle/contracts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { AuthPage, PasswordResetPage } from "./Auth";

const signedOut = { "/api/auth/get-session": null };

const passwordOnly: AuthCapabilities = {
  sso: null,
  passwordAuth: true,
  passwordReset: true,
  resetUrl: "http://localhost/reset-password",
  emailCode: false,
  passkeyRpId: null,
};

const meta = {
  title: "Views/Auth",
  component: AuthPage,
  args: { mode: "in" },
  argTypes: { mode: { control: "inline-radio", options: ["in", "up", "forgot"] } },
  parameters: { route: "/sign-in", http: signedOut },
} satisfies Meta<typeof AuthPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SignIn: Story = {};

export const SignUp: Story = { args: { mode: "up" }, parameters: { route: "/sign-up" } };

export const ForgotPassword: Story = {
  args: { mode: "forgot" },
  parameters: {
    route: "/forgot-password",
    http: { "/api/auth/capabilities": passwordOnly },
  },
};

export const PasswordOnly: Story = {
  parameters: { http: { "/api/auth/capabilities": passwordOnly } },
};

export const WithSso: Story = {
  parameters: {
    http: {
      "/api/auth/capabilities": {
        ...passwordOnly,
        sso: { name: "Example SSO", availability: "available" },
      } satisfies AuthCapabilities,
    },
  },
};

export const SsoOnly: Story = {
  parameters: {
    http: {
      "/api/auth/capabilities": {
        sso: { name: "Example SSO", availability: "available" },
        passwordAuth: false,
        passwordReset: false,
        resetUrl: null,
        emailCode: false,
        passkeyRpId: null,
      } satisfies AuthCapabilities,
    },
  },
};

export const EmailCode: Story = {
  parameters: {
    http: { "/api/auth/email-otp/send-verification-otp": { success: true } },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(await canvas.findByLabelText("Email"), "ada@example.test");
    await userEvent.click(canvas.getByRole("button", { name: "Continue" }));
    await canvas.findByText("Check your email");
  },
};

export const CheckEmail: Story = {
  args: { mode: "up" },
  parameters: { route: "/sign-up?verify=email" },
};

export const RedirectError: Story = {
  parameters: { route: "/sign-in?error=REGISTRATION_CLOSED" },
};

export const OptionsUnavailable: Story = {
  parameters: { http: { "/api/auth/capabilities": null } },
};

export const ResetPassword: Story = {
  parameters: { route: "/reset-password?token=story-token" },
  render: () => <PasswordResetPage />,
};

export const ResetLinkExpired: Story = {
  parameters: { route: "/reset-password" },
  render: () => <PasswordResetPage />,
};
