import { afterEach, describe, expect, it, vi } from "vitest";
import { FakePaymentWallet, fakeJobs, fakePurchasePrisma } from "./fake-purchases.js";
import { pollPurchase, reconcilePurchases } from "./purchase-poll.js";
import { executePurchaseTool } from "./purchase-service.js";

vi.mock("./payment-wallets.js", () => ({
  withPaymentWalletCredential: async (
    _deps: unknown,
    _actor: unknown,
    fn: (credential: { secret: string; refreshAt: null }) => Promise<unknown>,
  ) => fn({ secret: "credential", refreshAt: null }),
}));

const fixture = { spaceId: "space-1", userId: "user-1", botId: "bot-1", threadId: "thread-1" };

async function setup() {
  const db = fakePurchasePrisma(fixture);
  const queue = fakeJobs();
  const wallet = new FakePaymentWallet();
  const deps = {
    prisma: db.prisma,
    secretStore: {} as never,
    jobs: queue.jobs,
    paymentWallet: wallet,
  };
  await executePurchaseTool(
    deps,
    {
      operationId: "op-1",
      traceId: "op-1",
      spaceId: fixture.spaceId,
      userId: fixture.userId,
      botId: fixture.botId,
      signal: new AbortController().signal,
    },
    { threadId: fixture.threadId },
    "request_purchase",
    {
      merchantName: "Example Store",
      merchantUrl: "https://shop.example.test/checkout",
      amount: 1999,
      currency: "usd",
      reason: "Two boxes of printer paper for the office, as the user asked this morning. ".repeat(
        2,
      ),
    },
  );
  queue.enqueued.length = 0;
  const approve = () =>
    wallet.snapshots.set("remote-op-1", { id: "remote-op-1", status: "approved" });
  const poll = () => pollPurchase(deps, { purchaseId: "purchase-1" });
  return { ...db, ...queue, wallet, deps, approve, poll, row: () => db.purchases[0]! };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("pollPurchase", () => {
  it("retries later on a transient error", async () => {
    const env = await setup();
    env.wallet.getError = new Error("network");
    await env.poll();
    expect(env.row()).toMatchObject({ status: "pending_approval" });
    expect(env.row().nextPollAt!.getTime()).toBeGreaterThan(Date.now() + 10_000);
    expect(env.enqueued.map((job) => job.name)).toEqual(["purchase.poll"]);
  });
});

describe("reconcilePurchases", () => {
  it("re-enqueues due polls for the configured wallet", async () => {
    const env = await setup();
    env.row().nextPollAt = new Date(Date.now() - 1);
    await reconcilePurchases(env.deps);
    expect(env.enqueued).toEqual([
      expect.objectContaining({ name: "purchase.poll", payload: { purchaseId: "purchase-1" } }),
    ]);
    env.enqueued.length = 0;
    await reconcilePurchases({ ...env.deps, paymentWallet: null });
    expect(env.enqueued).toHaveLength(0);
  });
});
