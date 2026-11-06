import { createComputerUpdates, isUnauthorizedError } from "@labradoodle/core";
import { rpc, spaceSelectionSeq } from "./api";
export const computerUpdates = createComputerUpdates({
  list: async () => {
    const selection = spaceSelectionSeq();
    try {
      return await rpc("computer/updates");
    } catch (error) {
      // A 401 sent before a workspace switch belongs to the old one, not a lost session, and the
      // poller outlives the switch: report it as transient so polling continues.
      if (isUnauthorizedError(error) && selection !== spaceSelectionSeq()) {
        throw new Error("Space changed", { cause: error });
      }
      throw error;
    }
  },
  // Always the caller's own computer; the target the shared poller passes means nothing here.
  start: (_own, action) => rpc(`computer/${action}`),
  dismiss: (id) => rpc("computer/dismissUpdate", { id }),
});
