import { createComputerUpdates } from "@labradoodle/core";
import { rpc } from "./rpc";
export const computerUpdates = createComputerUpdates({
  list: () => rpc.computer.updates(),
  start: (_computer, action) => rpc.computer[action](),
  dismiss: (id) => rpc.computer.dismissUpdate({ id }),
});
