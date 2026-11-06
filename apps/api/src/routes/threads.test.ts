import type { Actor } from "@labradoodle/contracts";
import { describe, expect, it, vi } from "vitest";
import type { RouterDeps } from "../router.js";
import { releaseComputerControl } from "./computer.js";
import { takeoverReleaser } from "./threads.js";

vi.mock("./computer.js", () => ({ releaseComputerControl: vi.fn().mockResolvedValue(undefined) }));

const actor = { spaceId: "space-1", userId: "user-1" } as Actor;

describe("takeoverReleaser", () => {
  it("hands the sender's screen back to the run their reply steers", async () => {
    const deps = {} as RouterDeps;
    await takeoverReleaser(deps, actor)("run-1");
    expect(releaseComputerControl).toHaveBeenCalledWith(deps, actor, "done", "run-1");
  });
});
