import { createComputerUpdates } from "@labradoodle/core";
import { rpc } from "./rpc";
export const computerUpdates = createComputerUpdates({
  list: () => rpc.computer.updates(),
  start: (action) => rpc.computer[action](),
  dismiss: (id) => rpc.computer.dismissUpdate({ id }),
});
