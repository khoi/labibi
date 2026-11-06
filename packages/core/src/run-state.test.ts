import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  ACTIVE_RUN_STATUSES,
  assertTransition,
  canTransition,
  isActive,
  isConversationalRun,
  isRunWaitingOnUser,
  isRunWorking,
  messageBypassesTakeoverWait,
  messageSteersRun,
  QUEUE_HOLDING_RUN_STATUSES,
  WAITING_ON_USER_RUN_STATUSES,
  WORKING_RUN_STATUSES,
} from "./run-state.js";

describe("run state machine", () => {
  it("keeps paused cards active without holding admission, while takeover still holds it", () => {
    expect(isActive("waiting_input")).toBe(true);
    expect(QUEUE_HOLDING_RUN_STATUSES).toEqual(["queued", "leased", "running", "waiting_takeover"]);
  });

  it("lets a takeover wait hold only a message it takes as steering", () => {
    const bypasses = messageBypassesTakeoverWait;
    expect(bypasses({ status: "waiting_takeover", trigger: "user" })).toBe(false);
    expect(bypasses({ status: "waiting_takeover", trigger: "user" }, false)).toBe(true);
    expect(bypasses({ status: "waiting_takeover", trigger: "routine" })).toBe(true);
    expect(bypasses({ status: "running", trigger: "routine" })).toBe(false);
  });

  it("keeps webhook deliveries and background turns out of steering", () => {
    expect(messageSteersRun("user", "user")).toBe(true);
    expect(messageSteersRun("webhook", "user")).toBe(false);
    expect(messageSteersRun("user", "routine")).toBe(false);
  });

  it("splits active runs into working and waiting on the user", () => {
    expect(WORKING_RUN_STATUSES.filter((status) => isRunWaitingOnUser(status))).toEqual([]);
    expect([...WORKING_RUN_STATUSES, ...WAITING_ON_USER_RUN_STATUSES].sort()).toEqual(
      [...ACTIVE_RUN_STATUSES].sort(),
    );
    // A card waiting on the user is not the bot working.
    expect(isRunWorking("waiting_input")).toBe(false);
    expect(isRunWorking("waiting_takeover")).toBe(false);
    expect(isRunWaitingOnUser("waiting_takeover")).toBe(true);
    expect(isRunWorking("running")).toBe(true);
    expect(isRunWorking("idle")).toBe(false);
    expect(isRunWorking(undefined)).toBe(false);
  });

  it("allows takeover resume onto a lease", () => {
    expect(canTransition("waiting_takeover", "leased")).toBe(true);
    expect(canTransition("waiting_takeover", "running")).toBe(false);
  });

  it("withholds user steering from routine and webhook turns", () => {
    expect(isConversationalRun("user")).toBe(true);
    expect(isConversationalRun("follow_up")).toBe(true);
    expect(isConversationalRun("routine")).toBe(false);
    expect(isConversationalRun("webhook")).toBe(false);
  });

  it("rejects rewriting a completed run", () => {
    expect(() => assertTransition("completed", "running")).toThrow(/illegal/i);
  });

  it("never leaves a terminal state except failed retry", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("completed" as const, "cancelled" as const),
        fc.constantFrom(
          "queued" as const,
          "leased" as const,
          "running" as const,
          "waiting_input" as const,
          "completed" as const,
        ),
        (from, to) => {
          expect(canTransition(from, to)).toBe(false);
        },
      ),
    );
  });
});
