# Connect apps

Connect Gmail, Slack, Notion, GitHub and other apps so bots can read and act in them for you.

## Connect from chat

The easiest way is to ask: "connect my Google Calendar". The bot posts a card in the chat; choose
**Connect** or **Sign in** and finish signing in with the app.

## Connect from Integrations

Choose **Connect apps** at the bottom of the sidebar to open **Integrations**. Search or browse
**Apps** by category, choose one, and then **Connect**.

Once an app is connected, every bot in the [space](./spaces.md) can use it. You don't set it up per
bot. From an app's page you can **Reconnect** it, rename an account, or **Uninstall** it.

> [!NOTE]
> The app catalog depends on your server. A self-hosted server shows it only when the operator has
> configured an app catalog. See [Self-hosting](./self-host.md). Custom sources, below, work on any
> server.

## Add your own tools

The **+** in **Integrations** adds tools that aren't in the catalog:

- **MCP server**: any remote MCP server at an HTTPS address. **Browse MCP servers** searches a public
  directory of them.
- **OpenAPI** and **GraphQL**: point at an API's description and the bot can call it.
- **Treg** and **Executor**: tool gateways that connect with one access token.
- **From GitHub**: install a plugin from its repository. See [Build a plugin](./build-a-plugin.md).

Choose an authentication method (**No auth**, **Bearer token** or **API key header**) and then
**Verify and add**. Credentials are encrypted and never sent to the model.

**Manage MCP servers** lists every server you've added, with **Test connection** and OAuth sign-in.
Your MCP servers work in every chat where a bot answers you.

During one bot run, every call to an MCP server added under **Integrations** (Treg, Executor or
your own MCP URL) reuses one session, so servers that keep state in the session (a paused step
you confirm mid-run, for example) see the same session until the run ends. Two runs never share
such a session, and each closes when its run ends or after about ten minutes without a call. A
paused step can be resumed only while the run continues in the same Labradoodle instance, within that
window and within the server's own pause window (Executor keeps a pause for about four minutes).
After ten idle minutes, or when the run continues on another instance, the next call opens a fresh
session.

## Apps in chat

Some MCP servers come with an app: a small interactive view of a tool's result, such as a chart,
map or board. When a bot uses one of those tools, the app shows in the chat above the bot's reply,
in the web, desktop and mobile apps.

Apps run sandboxed. An app sees only that tool call and its result, reaches only the sites its
server declares, and can't call tools or see your account. A link in an app asks before it opens,
and a message an app suggests goes into the message box for you to send.

## Servers a bot adds

When a bot adds an MCP server for you, it stays off until you approve it in the chat. Choose
**Approve**, or **Authorize** if the server needs you to sign in.

## Every space

Skills, MCP servers and plugins you add work in all your [spaces](./spaces.md). App connections stay
in the space you connected them in.

## APIs without an integration

For a service with only an API key or a website login, ask the bot to save it. See
[Reusable credentials](./bot-secrets.md).
