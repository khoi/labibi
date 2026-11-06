import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ComposioConnector,
  ExpoPushProvider,
  FakeComposioClient,
  PrismaPushTokenStore,
} from "@labradoodle/adapters";
import type { createApp } from "@labradoodle/api/app";
import type { appContract } from "@labradoodle/contracts";
import { pushSessionExpiresAt, runAsSystem, runAsTenant } from "@labradoodle/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sessionCookieHeader } from "./index.js";
import { asSystem } from "./system-db.js";

type App = { request: (input: string, init?: RequestInit) => Response | Promise<Response> };
type AppHandles = Awaited<ReturnType<typeof createApp>>;
type RpcPath<T, Prefix extends string = ""> = T extends { "~orpc": unknown }
  ? Prefix
  : T extends object
    ? {
        [Key in keyof T & string]: RpcPath<T[Key], Prefix extends "" ? Key : `${Prefix}/${Key}`>;
      }[keyof T & string]
    : never;
type ProtectedRpcPath = Exclude<RpcPath<typeof appContract>, "health">;

process.env.WAKEUP_DRIVER = "memory";
process.env.SANDBOX_PROVIDER = "fake";
process.env.AGENT_RUNTIME = "scripted";

const hasDb = process.env.VERIFY_DATABASE === "1" && Boolean(process.env.DATABASE_URL);
const describeWithDatabase = hasDb ? describe : describe.skip;

describeWithDatabase("API authorization and resource isolation", () => {
  let handles: AppHandles;
  let db: AppHandles["prisma"];
  let pushTokens: PrismaPushTokenStore;
  const encryptionKey = "offline-authorization-encryption-key";
  const loadPushToken = async (userId: string) => (await pushTokens.load(userId))?.token;
  let app: App;
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const dataDir = mkdtempSync(path.join(tmpdir(), "labradoodle-authz-"));

  beforeAll(async () => {
    const { createApp } = await import("@labradoodle/api/app");
    handles = await createApp({
      databaseUrl: process.env.DATABASE_URL!,
      encryptionKey,
      dataDir,
      sandboxProvider: "fake",
      agentRuntime: "scripted",
      wakeupDriver: "memory",
      signupsEnabled: "true",
      composio: new ComposioConnector({ client: new FakeComposioClient() }),
    });
    pushTokens = new PrismaPushTokenStore(handles.prisma, encryptionKey);
    app = handles.app;
    db = asSystem(handles.prisma);
  });

  afterAll(async () => {
    await handles?.stop();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("rejects unauthenticated calls to every protected RPC family", async () => {
    const calls = exhaustiveProtectedCalls([
      ["me"],
      ["deployment/get"],
      ["deployment/update", { signupsEnabled: true }],
      ["updater/status"],
      ["updater/check", {}],
      ["updater/apply", {}],
      ["models/list"],
      ["models/credentials"],
      ["models/connect", { provider: "test", apiKey: "not-a-real-key" }],
      ["models/beginOAuth", { provider: "openai-codex" }],
      ["models/submitOAuthCode", { loginId: "missing-login", code: "fake-code" }],
      ["models/completeOAuth", { loginId: "missing-login" }],
      ["models/finishOAuth", { loginId: "missing-login" }],
      ["models/cancelOAuth", { loginId: "missing-login" }],
      ["models/setDefault", { provider: "test", modelId: "test/model" }],
      ["models/forRole"],
      ["models/role"],
      ["models/setRole"],
      ["models/backups"],
      ["models/setBackups"],
      ["models/probeOpenAiCompatible"],
      ["models/probeCatalog"],
      ["models/rename"],
      ["models/disconnect"],
      ["spaces/list"],
      ["spaces/rename", { spaceId: "missing-space", name: "Nope" }],
      ["spaces/members/list", { spaceId: "missing-space" }],
      ["spaces/members/remove", { spaceId: "missing-space", userId: "missing-user" }],
      ["spaces/members/leave", { spaceId: "missing-space" }],
      ["spaces/invites/create", { spaceId: "missing-space" }],
      ["spaces/invites/preview", { token: "missing-token" }],
      ["spaces/invites/accept", { token: "missing-token" }],
      ["spaces/invites/cancel", { spaceId: "missing-space" }],
      ["doodle/get"],
      ["doodle/update", { instructions: "Nope" }],
      ["doodle/restoreInstructions"],
      ["threads/list"],
      ["threads/create", { userIds: [], doodle: true }],
      ["threads/members", { threadId: "missing-thread" }],
      ["threads/addMembers", { threadId: "missing-thread", userIds: ["missing-user"] }],
      ["threads/setDoodle", { threadId: "missing-thread", doodle: false }],
      ["threads/rename", { threadId: "missing-thread", name: null }],
      ["threads/leave", { threadId: "missing-thread" }],
      ["threads/delete", { threadId: "missing-thread" }],
      ["threads/setMuted", { threadId: "missing-thread", muted: true }],
      ["threads/get", { threadId: "missing-thread" }],
      ["threads/messages", { threadId: "missing-thread", before: 1 }],
      ["threads/subscribe", { threadId: "missing-thread", cursor: -1 }],
      ["threads/send", { threadId: "missing-thread", text: "Nope" }],
      [
        "threads/sendWithRoutines",
        { threadId: "missing-thread", clientNonce: "nope", routineIds: ["missing-routine"] },
      ],
      ["threads/stop", { threadId: "missing-thread" }],
      ["threads/clear", { threadId: "missing-thread" }],
      [
        "threads/answer",
        {
          threadId: "missing-thread",
          runId: "missing-run",
          messageId: "missing-message",
          answer: "Nope",
        },
      ],
      ["threads/markRead", { threadId: "missing-thread" }],
      ["threads/markUnread", { threadId: "missing-thread" }],
      ["threads/head"],
      ["threads/react"],
      ["threads/answer"],
      ["computer/status", {}],
      ["computer/boot", {}],
      ["computer/stop", {}],
      ["computer/takeover", {}],
      ["computer/release", {}],
      ["computer/input", { kind: "key", payload: { key: "A" } }],
      ["computer/files", { path: "/" }],
      ["computer/readFile", { path: "MEMORY.md" }],
      ["computer/screenUrl", {}],
      ["computer/heartbeat", {}],
      ["computer/recover"],
      ["computer/reset"],
      ["computer/update"],
      ["computer/updates"],
      ["computer/releaseInterrupted"],
      ["computer/dismissUpdate"],
      ["computer/dismissDiskWarning", {}],
      ["computer/downloadFile"],
      ["computer/uploadFile"],
      ["computer/terminalUrl"],
      ["computer/commands"],
      ["computerProvider/get"],
      ["computerProvider/update", { provider: "default" }],
      ["computerProvider/account/get"],
      ["computerProvider/account/update", { provider: "default" }],
      ["memory/list", {}],
      ["memory/budget", { threadId: "missing-thread" }],
      ["memory/update", { documentId: "missing-memory", content: "Nope" }],
      ["memory/exportMarkdown", {}],
      ["memory/remove"],
      ["memory/providerConfig"],
      ["memory/connectProvider"],
      ["memory/disconnectProvider"],
      ["routines/list", { threadId: "missing-thread" }],
      ["routines/rotateWebhookSecret", { routineId: "missing-routine" }],
      ["routines/create", routineInput("missing-thread")],
      ["routines/update", { routineId: "missing-routine", name: "Nope" }],
      ["routines/remove", { routineId: "missing-routine" }],
      ["routines/testRun", { routineId: "missing-routine" }],
      ["routines/history"],
      ["skills/list"],
      ["skills/get", { skillId: "missing-skill" }],
      ["skills/start", { goal: "Demonstrate export" }],
      [
        "skills/appendEvent",
        {
          skillId: "missing-skill",
          event: { at: new Date().toISOString(), kind: "key", key: "a" },
        },
      ],
      ["skills/snapshot", { skillId: "missing-skill" }],
      ["skills/stop", { skillId: "missing-skill" }],
      ["skills/updateDraft", { skillId: "missing-skill", playbook: skillPlaybookInput() }],
      ["skills/save", { skillId: "missing-skill" }],
      ["skills/testRun", { skillId: "missing-skill" }],
      ["skills/remove", { skillId: "missing-skill" }],
      ["skills/appendEvent"],
      ["agentSkills/list"],
      ["agentSkills/get", { skillId: "missing-skill" }],
      ["agentSkills/create", { name: "Unauthenticated", description: "Nope", body: "Steps" }],
      ["agentSkills/update", { skillId: "missing-skill", description: "Nope" }],
      ["agentSkills/remove", { skillId: "missing-skill" }],
      ["capabilities/list"],
      ["capabilities/install", capabilityInput("Unauthenticated")],
      ["capabilities/remove", { id: "missing-capability" }],
      ["capabilities/catalogSearch"],
      ["capabilities/pluginParts"],
      ["capabilities/pluginPreview"],
      ["connections/catalog", {}],
      ["connections/list"],
      ["connections/begin", connectionInput("Unauthenticated")],
      ["connections/complete", { connectionId: "missing-connection" }],
      ["connections/revoke", { connectionId: "missing-connection" }],
      ["connections/rename"],
      ["connections/tools"],
      ["approvalRules/list"],
      ["approvalRules/set", { effect: "deny", matchKind: "tool", matchValue: "gmail_send_email" }],
      ["approvalRules/remove", { id: "missing-rule" }],
      ["artifacts/list", { threadId: "missing-thread" }],
      ["artifacts/listSpace"],
      ["artifacts/listVersions"],
      ["artifacts/create"],
      ["artifacts/get"],
      ["artifacts/getById"],
      ["artifacts/remove"],
      ["pages/list"],
      ["pages/get"],
      ["pages/rename"],
      ["pages/setVisibility"],
      ["pages/pin"],
      ["pages/remove"],
      ["usage/list"],
      ["usage/summary"],
      ["export/accountToken"],
      ["notifications/subscribe"],
      ["notifications/registerPush", { token: "ExponentPushToken[not-real]" }],
      ["notifications/unregisterPush"],
      ["search/query", { q: "anything" }],
      ["voice/catalog"],
      ["voice/status"],
      ["voice/credentials"],
      ["voice/connect", { provider: "elevenlabs", apiKey: "not-a-real-key" }],
      ["voice/disconnect", { provider: "elevenlabs" }],
      ["voice/setVoice", { voiceId: "missing-voice" }],
      ["voice/voices", {}],
      ["voice/prepare", { text: "Nope" }],
      ["voice/setSpeechModel"],
      ["analytics/screen"],
      ["aiConsent/status"],
      ["aiConsent/allow"],
      ["aiConsent/revoke"],
      ["preferences/update"],
      ["preferences/adoptTimezone"],
      ["bootstrap"],
      ["security/events"],
      ["audit/events"],
      ["marketplace/catalog"],
      ["marketplace/review"],
      ["marketplace/submissions"],
      ["mcp/servers/list"],
      ["mcp/servers/create"],
      ["mcp/servers/update"],
      ["mcp/servers/remove"],
      ["mcp/servers/test"],
      ["mcp/approvals/approve"],
      ["mcp/approvals/dismiss"],
      ["mcp/oauth/begin"],
      ["mcp/oauth/complete"],
      ["mcp/oauth/disconnect"],
      ["onboarding/signupSurvey"],
      ["onboarding/promptFocus"],
      ["onboarding/choose"],
      ["onboarding/dismissFocus"],
      ["onboarding/appConnected"],
      ["integrationSetup/get"],
      ["integrationSetup/save"],
      ["trustedLinkSites/list"],
      ["trustedLinkSites/trust"],
      ["trustedLinkSites/remove"],
      ["autoReview/get"],
      ["autoReview/set"],
      ["links/favicon"],
      ["runs/list"],
      ["paymentWallet/status"],
      ["paymentWallet/connect"],
      ["paymentWallet/disconnect"],
      ["spendingLimit/get"],
      ["spendingLimit/set", { limit: null }],
      ["vault/list"],
      ["vault/put"],
      ["vault/reveal"],
      ["vault/remove"],
    ]);

    const results = await Promise.all(
      calls.map(async ([procedure, input]) => ({
        procedure,
        response: await raw(app, "", procedure, input),
      })),
    );

    for (const { procedure, response } of results) {
      expect(response.status, procedure).toBe(401);
    }
  });

  it("hands a device's push token to the account that registers it last", async () => {
    const first = await signup(app, `push-first-${stamp}@labradoodle.test`, "Push First");
    const second = await signup(app, `push-second-${stamp}@labradoodle.test`, "Push Second");
    const firstUser = (await rpc<Actor>(app, first, "me")).userId;
    const secondUser = (await rpc<Actor>(app, second, "me")).userId;
    const device = "ExponentPushToken[shared-device]";

    await rpc(app, first, "notifications/registerPush", { token: device });
    // Another device, or unregistering, only ever touches the caller's own token.
    await rpc(app, second, "notifications/registerPush", { token: "ExponentPushToken[other]" });
    await rpc(app, second, "notifications/unregisterPush");
    await expect(loadPushToken(firstUser)).resolves.toBe(device);

    await rpc(app, second, "notifications/registerPush", { token: device });
    await expect(loadPushToken(secondUser)).resolves.toBe(device);
    await expect(loadPushToken(firstUser)).resolves.toBeUndefined();
    const multiline = await raw(app, first, "notifications/registerPush", {
      token: `${device}\nsession`,
    });
    expect(multiline.status).toBe(400);
  });

  // On the wire, the POST older phone apps send without a body arrives as an empty one.
  const emptyBody = { method: "POST", body: "" };

  it("ends the session when an older phone app signs out with an empty body", async () => {
    const phone = await phoneSession(app, `phone-sign-out-${stamp}@labradoodle.test`);
    const signedOut = await app.request("/api/auth/sign-out", {
      ...emptyBody,
      headers: { ...phone.headers, "content-type": "application/json", "content-length": "0" },
    });
    expect(signedOut.status).toBe(200);
    expect(await phone.me()).toBe(401);
  });

  it("accepts the deletion-code request older apps send with no body", async () => {
    const phone = await phoneSession(app, `phone-deletion-code-${stamp}@labradoodle.test`);
    const response = await app.request("/api/auth/request-account-deletion", {
      ...emptyBody,
      headers: { ...phone.headers, "content-length": "0" },
    });
    // A password account reaches the endpoint, which offers deletion by password instead.
    expect(await response.json()).toMatchObject({ code: "EMAIL_DELETION_UNAVAILABLE" });
  });

  it("still rejects a malformed auth body", async () => {
    const phone = await phoneSession(app, `phone-malformed-${stamp}@labradoodle.test`);
    const response = await app.request("/api/auth/sign-out", {
      method: "POST",
      headers: { ...phone.headers, "content-type": "application/json" },
      body: "{",
    });
    expect(response.status).toBe(400);
    expect(await phone.me()).toBe(200);
  });

  it("marks account and RPC replies as not cacheable, including errors", async () => {
    const email = `phone-no-store-${stamp}@labradoodle.test`;
    const phone = await phoneSession(app, email);
    const rpc = (path: string, headers: Record<string, string>) =>
      app.request(`/rpc/${path}`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ json: {} }),
      });
    const signIn = (password: string) =>
      app.request("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "labradoodle://" },
        body: JSON.stringify({ email, password }),
      });
    const responses = {
      signIn: await signIn("password12"),
      wrongPassword: await signIn("wrong-pass"),
      blockedAuthPath: await app.request("/api/auth/organization/list"),
      oversizedAuthBody: await app.request("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": String(1024 * 1024) },
        body: "{}",
      }),
      me: await rpc("me", phone.headers),
      signedOutMe: await rpc("me", { origin: "labradoodle://" }),
      unknownProcedure: await rpc("not-a-procedure", phone.headers),
    };

    expect(
      Object.fromEntries(
        Object.entries(responses).map(([name, response]) => [
          name,
          [response.status, response.headers.get("cache-control")],
        ]),
      ),
    ).toEqual({
      signIn: [200, "no-store"],
      wrongPassword: [401, "no-store"],
      blockedAuthPath: [404, "no-store"],
      oversizedAuthBody: [413, "no-store"],
      me: [200, "no-store"],
      signedOutMe: [401, "no-store"],
      unknownProcedure: [404, "no-store"],
    });
  });

  it("uses the bearer session over another account's session cookie", async () => {
    const a = await phoneSession(app, `phone-cookie-a-${stamp}@labradoodle.test`);
    const b = await phoneSession(app, `phone-cookie-b-${stamp}@labradoodle.test`);
    const both = { ...b.headers, cookie: a.cookie, "content-type": "application/json" };
    const me = () =>
      app.request("/rpc/me", { method: "POST", headers: both, body: JSON.stringify({ json: {} }) });

    const signedIn = await me();
    expect(signedIn.status).toBe(200);
    expect(await signedIn.json()).toMatchObject({ json: { userId: b.userId } });

    const signedOut = await app.request("/api/auth/sign-out", {
      method: "POST",
      headers: both,
      body: "{}",
    });
    expect(signedOut.status).toBe(200);
    expect((await me()).status).toBe(401);
    expect(await a.me()).toBe(200);
  });

  it("accepts only signed bearer tokens, and every sign-in hands one out", async () => {
    const email = `phone-signed-${stamp}@labradoodle.test`;
    const phone = await phoneSession(app, email);
    const me = async (token: string) =>
      (
        await app.request("/rpc/me", {
          method: "POST",
          headers: {
            origin: "labradoodle://",
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ json: {} }),
        })
      ).status;
    const authJson = async (path: string, token: string, body: unknown) => {
      const response = await app.request(`/api/auth${path}`, {
        method: "POST",
        headers: {
          origin: "labradoodle://",
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(200);
      const json = (await response.json()) as { token: string };
      expect(json.token).toBe(decodeURIComponent(response.headers.get("set-auth-token") ?? ""));
      return json.token;
    };

    const stored = await handles.prisma.session.findFirstOrThrow({
      where: { userId: phone.userId },
      select: { token: true },
    });
    expect(phone.token.startsWith(`${stored.token}.`)).toBe(true);
    expect(phone.token).toBe(decodeURIComponent(phone.setAuthToken));
    expect(await me(phone.token)).toBe(200);
    expect(await me(encodeURIComponent(phone.token))).toBe(200);

    // A token copied out of the session table, or given a forged signature, is not a session.
    expect(await me(stored.token)).toBe(401);
    expect(await me(`${stored.token}.${"A".repeat(43)}=`)).toBe(401);
    const rawSession = await app.request("/api/auth/get-session", {
      headers: { origin: "labradoodle://", authorization: `Bearer ${stored.token}` },
    });
    expect(await rawSession.json()).toBeNull();

    const signedIn = await authJson("/sign-in/email", "", { email, password: "password12" });
    expect(await me(signedIn)).toBe(200);

    // Replacing the session on a password change hands the phone the signed replacement.
    const replaced = await authJson("/change-password", signedIn, {
      currentPassword: "password12",
      newPassword: "password34",
      revokeOtherSessions: true,
    });
    expect(replaced).not.toBe(signedIn);
    expect(await me(replaced)).toBe(200);
    expect(await me(signedIn)).toBe(401);
  });

  it("drops a push token when the session that registered it is revoked", async () => {
    const email = `push-sessions-${stamp}@labradoodle.test`;
    const phone = await signup(app, email, "Push Sessions");
    const userId = (await rpc<Actor>(app, phone, "me")).userId;
    const token = "ExponentPushToken[phone]";
    await rpc(app, phone, "notifications/registerPush", { token });

    // Signing out or revoking other sessions elsewhere keeps the phone's token.
    await authPost(app, await signin(app, email), "/sign-out");
    await authPost(app, phone, "/revoke-other-sessions");
    await expect(loadPushToken(userId)).resolves.toBe(token);

    await authPost(app, await signin(app, email), "/revoke-other-sessions");
    await expect(loadPushToken(userId)).resolves.toBeUndefined();

    const relogged = await signin(app, email);
    await rpc(app, relogged, "notifications/registerPush", { token });
    await authPost(app, await signin(app, email), "/change-password", {
      currentPassword: "password12",
      newPassword: "password34",
      revokeOtherSessions: true,
    });
    await expect(loadPushToken(userId)).resolves.toBeUndefined();

    // Changing the password on the phone itself replaces its session; the token follows it.
    const samePhone = await signin(app, email, "password34");
    await rpc(app, samePhone, "notifications/registerPush", { token });
    await authPost(app, samePhone, "/change-password", {
      currentPassword: "password34",
      newPassword: "password56",
      revokeOtherSessions: true,
    });
    await expect(loadPushToken(userId)).resolves.toBe(token);
    await authPost(app, await signin(app, email, "password56"), "/revoke-other-sessions");
    await expect(loadPushToken(userId)).resolves.toBeUndefined();

    const signedIn = await signin(app, email, "password56");
    await rpc(app, signedIn, "notifications/registerPush", { token });
    await authPost(app, signedIn, "/revoke-sessions");
    await expect(loadPushToken(userId)).resolves.toBeUndefined();
  });

  it("does not deliver a push token after its session expires without a request", async () => {
    const email = `push-expired-${stamp}@labradoodle.test`;
    const phone = await signup(app, email, "Push Expired");
    const userId = (await rpc<Actor>(app, phone, "me")).userId;
    const token = "ExponentPushToken[expired-session]";
    await rpc(app, phone, "notifications/registerPush", { token });
    await handles.prisma.session.updateMany({
      where: { userId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    try {
      const push = new ExpoPushProvider(pushTokens, {
        sessionExpiresAt: (sessionId) => pushSessionExpiresAt(handles.prisma, sessionId),
      });
      await expect(
        push.deliver(
          { kind: "completion", title: "done", body: "secret", threadId: "t" },
          {
            operationId: "n",
            traceId: "n",
            spaceId: "w",
            userId,
            signal: new AbortController().signal,
          },
        ),
      ).resolves.toBe("undeliverable");
      expect(fetchMock).not.toHaveBeenCalled();
      await expect(loadPushToken(userId)).resolves.toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps approval rules private to each user in a shared Space", async () => {
    const owner = await signup(app, `approval-owner-${stamp}@labradoodle.test`, "Approval Owner");
    const member = await signup(
      app,
      `approval-member-${stamp}@labradoodle.test`,
      "Approval Member",
    );
    const ownerActor = await rpc<Actor>(app, owner, "me");
    const memberActor = await rpc<Actor>(app, member, "me");

    await handles.prisma.member.deleteMany({ where: { userId: memberActor.userId } });
    await handles.prisma.member.create({
      data: {
        id: `approval-member-${stamp}`,
        organizationId: ownerActor.spaceId,
        userId: memberActor.userId,
        role: "member",
        createdAt: new Date(),
      },
    });
    const ownerRule = await rpc<{ id: string }>(app, owner, "approvalRules/set", {
      effect: "always_allow",
      matchKind: "tool",
      matchValue: "destination.write",
    });
    expect(await rpc<unknown[]>(app, member, "approvalRules/list")).toEqual([]);

    const memberRule = await rpc<{ id: string }>(app, member, "approvalRules/set", {
      effect: "deny",
      matchKind: "tool",
      matchValue: "gmail_send_email",
    });
    expect(await rpc<Array<{ id: string }>>(app, owner, "approvalRules/list")).toEqual([
      expect.objectContaining({ id: ownerRule.id }),
    ]);
    expect(await rpc<Array<{ id: string }>>(app, member, "approvalRules/list")).toEqual([
      expect.objectContaining({ id: memberRule.id }),
    ]);

    await rpc(app, member, "approvalRules/remove", { id: ownerRule.id });
    expect(
      await asSystem(handles.prisma).userActionApprovalRule.findUnique({
        where: { id: ownerRule.id },
      }),
    ).not.toBeNull();
  });

  it("keeps the Better Auth organization routes closed to product sessions", async () => {
    const cookie = await signup(app, `org-routes-${stamp}@labradoodle.test`, "Org Routes");
    const actor = await rpc<Actor>(app, cookie, "me");

    for (const route of ["delete", "leave", "update", "list"]) {
      const res = await app.request(`/api/auth/organization/${route}`, {
        method: route === "list" ? "GET" : "POST",
        headers: {
          ...(route === "list" ? {} : { "content-type": "application/json" }),
          cookie,
          origin: "http://127.0.0.1:5173",
        },
        body:
          route === "list"
            ? undefined
            : JSON.stringify({ organizationId: actor.spaceId, data: { name: "Renamed" } }),
      });
      expect(res.status, route).toBe(404);
    }

    await expect(
      handles.prisma.space.findMany({ where: { id: actor.spaceId }, select: { id: true } }),
    ).resolves.toHaveLength(1);
    await expect(
      handles.prisma.member.count({ where: { userId: actor.userId } }),
    ).resolves.toBeGreaterThan(0);
    expect((await raw(app, cookie, "me")).status).toBe(200);
  });

  it("keeps compatible headers encrypted and out of DTOs across reconnects", async () => {
    const cookie = await signup(app, `model-headers-${stamp}@labradoodle.test`, "Model Headers");
    const actor = await rpc<Actor>(app, cookie, "me");
    const connection = {
      provider: "openai-compatible",
      modelId: "arbitrary-model",
      baseUrl: "http://localhost:8000/v1",
    };
    const connected = await rpc<ModelCredential>(app, cookie, "models/connect", {
      ...connection,
      headers: { "x-session": "fake-session-secret" },
    });
    expect(connected.headerNames).toEqual(["x-session"]);
    expect(JSON.stringify(connected)).not.toContain("fake-session-secret");
    const credential = await db.userModelCredential.findUniqueOrThrow({
      where: { id: connected.id },
    });
    const secret = await db.secret.findUniqueOrThrow({
      where: { id: credential.secretId },
    });
    expect(secret.ciphertext).not.toContain("fake-session-secret");
    await rpc(app, cookie, "models/connect", connection);
    expect(
      await runAsTenant(actor, () =>
        handles.executor.resolveModel({ userId: actor.userId, spaceId: actor.spaceId }),
      ),
    ).toMatchObject({ headers: { "x-session": "fake-session-secret" } });
    const listed = await rpc<Array<ModelCredential>>(app, cookie, "models/credentials");
    expect(listed.find((row) => row.id === connected.id)?.headerNames).toEqual(["x-session"]);
    expect(JSON.stringify(listed)).not.toContain("fake-session-secret");
    await rpc(app, cookie, "models/connect", { ...connection, headers: {} });
    expect(
      await runAsTenant(actor, () =>
        handles.executor.resolveModel({ userId: actor.userId, spaceId: actor.spaceId }),
      ),
    ).toMatchObject({ headers: {} });
    const cleared = await rpc<Array<ModelCredential>>(app, cookie, "models/credentials");
    expect(cleared.find((row) => row.id === connected.id)?.headerNames).toEqual([]);
  });

  it("validates custom thinking against the saved connection capability", async () => {
    const cookie = await signup(
      app,
      `custom-thinking-${stamp}@labradoodle.test`,
      "Custom Thinking",
    );
    const { doodle } = await rpc<{ doodle: { id: string } }>(app, cookie, "bootstrap", {});
    const connection = {
      provider: "openai-compatible",
      modelId: "arbitrary-model",
      baseUrl: "http://localhost:8000/v1",
    };
    await rpc(app, cookie, "models/connect", {
      ...connection,
      apiKey: "fake-saved-key",
      reasoning: false,
    });
    await rpc(app, cookie, "models/connect", { ...connection, reasoning: true });
    const actor = await rpc<Actor>(app, cookie, "me");
    expect(
      await runAsSystem("background job run.continue", () =>
        handles.executor.resolveModel({
          userId: actor.userId,
          spaceId: actor.spaceId,
          botId: doodle.id,
        }),
      ),
    ).toMatchObject({ apiKey: "fake-saved-key", reasoning: true });
    const update = {
      modelProvider: connection.provider,
      modelId: connection.modelId,
    };
    expect(
      await rpc(app, cookie, "doodle/update", { ...update, thinkingLevel: "low" }),
    ).toMatchObject({ thinkingLevel: "low" });
    expect(
      await rpc(app, cookie, "doodle/update", { ...update, thinkingLevel: "xhigh" }),
    ).toMatchObject({ thinkingLevel: "xhigh" });
    expect(
      await rpc(app, cookie, "doodle/update", { ...update, thinkingLevel: "max" }),
    ).toMatchObject({ thinkingLevel: "max" });
    await rpc(app, cookie, "models/connect", { ...connection, reasoning: false });
    expect(
      (await raw(app, cookie, "doodle/update", { ...update, thinkingLevel: "low" })).status,
    ).toBe(400);
    expect(
      (await raw(app, cookie, "doodle/update", { ...update, thinkingLevel: "xhigh" })).status,
    ).toBe(400);
    expect(
      await rpc(app, cookie, "doodle/update", { ...update, thinkingLevel: "off" }),
    ).toMatchObject({ thinkingLevel: "off" });
  });

  it("binds a new default to the space preference credential, not a newer unused duplicate", async () => {
    const cookie = await signup(
      app,
      `model-duplicates-${stamp}@labradoodle.test`,
      "Model Duplicates",
    );
    const actor = await rpc<Actor>(app, cookie, "me");
    const olderSecret = await db.secret.create({
      data: {
        userId: actor.userId,
        spaceId: null,
        kind: "model",
        ciphertext: "encrypted-older-key",
      },
    });
    const newerSecret = await db.secret.create({
      data: {
        userId: actor.userId,
        spaceId: null,
        kind: "model",
        ciphertext: "encrypted-newer-key",
      },
    });
    const older = await db.userModelCredential.create({
      data: {
        userId: actor.userId,
        provider: "duplicate-provider",
        label: "Older",
        secretId: olderSecret.id,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    });
    const newer = await db.userModelCredential.create({
      data: {
        userId: actor.userId,
        provider: "duplicate-provider",
        label: "Newer",
        secretId: newerSecret.id,
        createdAt: new Date("2026-02-01T00:00:00.000Z"),
        updatedAt: new Date("2026-02-02T00:00:00.000Z"),
      },
    });
    await db.userModelPreference.create({
      data: { userId: actor.userId, credentialId: older.id, modelId: "older/model" },
    });

    await rpc(app, cookie, "models/setDefault", {
      provider: "duplicate-provider",
      modelId: "newer/selected",
    });

    const preferences = await db.userModelPreference.findMany({
      where: { userId: actor.userId },
    });
    const main = await rpc<ModelRoleSettings>(app, cookie, "models/role", { role: "main" });
    expect(main.primary).toMatchObject({ modelId: "newer/selected", credentialId: older.id });
    expect(preferences.find((row) => row.credentialId === older.id)).toMatchObject({
      modelId: "newer/selected",
    });
    expect(preferences.find((row) => row.credentialId === newer.id)).toBeUndefined();
    const listed = await rpc<ModelCredential[]>(app, cookie, "models/credentials");
    expect(
      listed.filter((row) => row.provider === "duplicate-provider").map((row) => row.id),
    ).toEqual([newer.id, older.id]);
  });

  it("never hands out session tokens and asks for the password before account deletion", async () => {
    const email = `sessions-${stamp}@labradoodle.test`;
    const cookie = await signup(app, email, "Sessions");
    const second = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://127.0.0.1:5173" },
      body: JSON.stringify({ email, password: "password12" }),
    });
    const { token } = (await second.json()) as { token: string };
    expect(token).toEqual(expect.any(String));

    const listed = await app.request("/api/auth/list-sessions", { headers: { cookie } });
    expect(listed.status).toBe(200);
    const text = await listed.text();
    const sessions = JSON.parse(text) as Array<Record<string, unknown>>;
    expect(sessions).toHaveLength(2);
    for (const session of sessions) expect(session).not.toHaveProperty("token");
    expect(text).not.toContain(token);
    const current = (await (
      await app.request("/api/auth/get-session", { headers: { cookie } })
    ).json()) as { session: Record<string, unknown> };
    expect(current.session).not.toHaveProperty("token");

    const deleted = await app.request("/api/auth/delete-user", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin: "http://127.0.0.1:5173" },
      body: JSON.stringify({}),
    });
    expect(deleted.status).toBe(400);
    expect(await handles.prisma.user.findUnique({ where: { email } })).not.toBeNull();
  });

  it("denies server administration to every app account, including a stored former owner", async () => {
    const formerOwner = await signup(app, `former-owner-${stamp}@labradoodle.test`, "Test Account");
    const other = await signup(app, `ordinary-${stamp}@labradoodle.test`, "Other Account");
    const account = await rpc<Actor>(app, formerOwner, "me");
    await handles.prisma.deploymentSettings.update({
      where: { id: "default" },
      data: { ownerUserId: account.userId },
    });
    for (const cookie of [formerOwner, other]) {
      expect((await rpc<Actor>(app, cookie, "me")).isDeploymentOwner).toBe(false);
      await expectForbidden(app, cookie, "deployment/get", {});
      await expectForbidden(app, cookie, "deployment/update", { signupsEnabled: false });
      await expectForbidden(app, cookie, "security/events", {});
      await expectForbidden(app, cookie, "updater/status", {});
      await expectForbidden(app, cookie, "updater/check", {});
      await expectForbidden(app, cookie, "updater/apply", {});
      await expectForbidden(app, cookie, "integrationSetup/save", {
        provider: "composio",
        apiKey: "fake-key",
      });
    }
    expect(
      await handles.prisma.deploymentSettings.findUniqueOrThrow({ where: { id: "default" } }),
    ).toMatchObject({ signupsEnabled: true, signupAllowlist: "" });
  });
});

function routineInput(threadId: string) {
  return {
    threadId,
    name: "Owner Routine",
    prompt: "owner-only prompt",
    crons: ["0 9 * * 1"],
    timezone: "UTC",
    notify: false,
    active: false,
  };
}

function skillPlaybookInput() {
  return {
    whenToUse: "When needed",
    inputs: ["example"],
    steps: ["Do the thing"],
    howToCheck: "Verify result",
    whatToReturn: "Summary",
    approvalBoundaries: "Ask first",
    failureHandling: "Stop and ask",
  };
}

function capabilityInput(name: string) {
  return { kind: "skill", name, source: "test://authorization", config: {} };
}

function connectionInput(displayName: string) {
  return { provider: "SLACK", displayName };
}

async function signup(app: App, email: string, name: string) {
  const response = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://127.0.0.1:5173" },
    body: JSON.stringify({ email, password: "password12", name }),
  });
  if (response.status >= 400) {
    throw new Error(`signup failed ${response.status}: ${await response.text()}`);
  }
  return sessionCookieHeader(response);
}

async function phoneSession(app: App, email: string) {
  const response = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "labradoodle://" },
    body: JSON.stringify({ email, password: "password12", name: "Phone" }),
  });
  const { token, user } = (await response.json()) as { token: string; user: { id: string } };
  const cookie = sessionCookieHeader(response);
  const headers = { origin: "labradoodle://", authorization: `Bearer ${token}` };
  const me = async () =>
    (
      await app.request("/rpc/me", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ json: {} }),
      })
    ).status;
  const setAuthToken = response.headers.get("set-auth-token") ?? "";
  return { headers, me, cookie, userId: user.id, token, setAuthToken };
}

async function signin(app: App, email: string, password = "password12") {
  return sessionCookieHeader(await authPost(app, "", "/sign-in/email", { email, password }));
}

async function authPost(app: App, cookie: string, path: string, body: unknown = {}) {
  const response = await app.request(`/api/auth${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      origin: "http://127.0.0.1:5173",
    },
    body: JSON.stringify(body),
  });
  if (response.status >= 400) {
    throw new Error(`${path} failed ${response.status}: ${await response.text()}`);
  }
  return response;
}

async function raw(
  app: App,
  cookie: string,
  procedure: string,
  body: unknown = {},
  spaceId?: string,
) {
  return app.request(`/rpc/${procedure}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(spaceId ? { "x-labradoodle-space-id": spaceId } : {}),
      origin: "http://127.0.0.1:5173",
    },
    body: JSON.stringify({ json: body ?? {} }),
  });
}

async function rpc<T>(
  app: App,
  cookie: string,
  procedure: string,
  body: unknown = {},
  spaceId?: string,
): Promise<T> {
  const response = await raw(app, cookie, procedure, body, spaceId);
  const text = await response.text();
  const payload = JSON.parse(text) as { json?: T; error?: { message?: string } };
  if (response.status >= 400 || payload.error) {
    throw new Error(`${procedure} ${response.status}: ${payload.error?.message ?? text}`);
  }
  return payload.json as T;
}

async function expectForbidden(app: App, cookie: string, procedure: string, body: unknown) {
  const response = await raw(app, cookie, procedure, body);
  expect(response.status, procedure).toBe(403);
  expect(await response.text(), procedure).toMatch(/forbidden/i);
}

interface Actor {
  userId: string;
  spaceId: string;
  isDeploymentOwner: boolean;
}

interface ModelRoleSettings {
  primary: { provider: string; modelId: string; credentialId?: string } | null;
}

interface ModelCredential {
  headerNames?: string[];
  id: string;
  provider: string;
  label: string;
  hasKey: boolean;
  isDefault: boolean;
}

function exhaustiveProtectedCalls<
  const Calls extends ReadonlyArray<readonly [ProtectedRpcPath, unknown?]>,
>(calls: Calls & (ProtectedRpcPath extends Calls[number][0] ? unknown : never)): Calls {
  return calls;
}
