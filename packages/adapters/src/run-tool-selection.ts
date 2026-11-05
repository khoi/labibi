import { disabledBuiltinToolSet } from "@labradoodle/contracts";
import { isBackgroundRunTrigger, isPersonStartedRun } from "@labradoodle/core";
import { builtinAgentTools } from "./builtin-tools.js";
import { selectCloudAgentTools } from "./cloud-agent-tools-select.js";
import { selectMemoryTools } from "./memory-tools.js";
import { filterImageReturningComputerTools } from "./model-vision.js";
import { USER_COMPUTER_SCREEN_TOOLS } from "./run-tools-user-computer.js";
import { filterBuiltinToolsForRun } from "./schedule-tools.js";

export const READ_ONLY_AGENT_TOOLS = new Set([
  "computer_observe",
  "list_files",
  "read_file",
  "read_history",
  "search_history",
  "request_takeover",
  "run_subagent",
  "task_catalog",
  "recall_memory",
  "schedule_list",
  "skill_read",
  "web_search",
  "web_fetch",
  "browser_snapshot",
  "list_secrets",
  "cloud_agent_status",
  "purchase_status",
]);

/** Offered only to a user who connected a wallet. */
const PURCHASE_TOOL_NAMES = new Set(["request_purchase", "purchase_status", "paid_request"]);

export const BUILTIN_AGENT_TOOL_NAMES = new Set(builtinAgentTools.map((tool) => tool.name));

export function selectBuiltinToolsForRun(options: {
  historyRetrievalEnabled?: boolean;
  graphicalToolsAllowed: boolean;
  /** Page browser tools need a graphical computer (Chrome), not model vision. */
  pageBrowserAllowed?: boolean;
  groupId: string | null;
  trigger: string;
  semanticMemoryEnabled: boolean;
  /** The configured provider can forget individual facts. */
  semanticMemoryForgets?: boolean;
  cloudAgentEnabled?: boolean;
  /** The run's user connected a payment wallet. */
  paymentWalletEnabled?: boolean;
  mediaImagesEnabled?: boolean;
  mediaVideoEnabled?: boolean;
  /** Built-in names this bot turned off. Unknown names are ignored. */
  disabledBuiltinTools?: readonly string[];
  /** A follow-up run whose source message the user wrote. */
  followUpFromUser?: boolean;
  /** The person who started this run has their desktop connected (see userComputerOwner). */
  userComputer?: boolean;
  /** That desktop can look at and drive its apps. */
  userComputerScreen?: boolean;
}) {
  const disabled = disabledBuiltinToolSet(options.disabledBuiltinTools);
  const ownerStartedRun = isPersonStartedRun(options.trigger, Boolean(options.followUpFromUser));
  return selectCloudAgentTools(
    selectMemoryTools(
      filterBuiltinToolsForRun(
        filterPageBrowserTools(
          filterImageReturningComputerTools(builtinAgentTools, options.graphicalToolsAllowed),
          options.pageBrowserAllowed ?? options.graphicalToolsAllowed,
        ),
        options.trigger,
      ),
      options.semanticMemoryEnabled,
      Boolean(options.semanticMemoryForgets),
    ),
    Boolean(options.cloudAgentEnabled),
  ).filter(
    (tool) =>
      !disabled.has(tool.name) &&
      (ownerStartedRun || (tool.name !== "update_preferences" && tool.name !== "feedback")) &&
      (options.paymentWalletEnabled || !PURCHASE_TOOL_NAMES.has(tool.name)) &&
      (options.mediaImagesEnabled || tool.name !== "generate_image") &&
      (options.mediaVideoEnabled || tool.name !== "generate_video") &&
      (!isBackgroundRunTrigger(options.trigger) ||
        !["message_user", "generate_image", "generate_video"].includes(tool.name)) &&
      (options.userComputer || tool.name !== "user_computer_shell") &&
      ((options.userComputer && options.userComputerScreen) ||
        !USER_COMPUTER_SCREEN_TOOLS.has(tool.name)) &&
      (options.historyRetrievalEnabled || !["search_history", "read_history"].includes(tool.name)),
  );
}

export const PAGE_BROWSER_TOOL_NAMES = new Set([
  "browser_navigate",
  "browser_snapshot",
  "browser_act",
]);

export function filterPageBrowserTools<T extends { name: string }>(
  tools: T[],
  pageBrowserAllowed: boolean,
): T[] {
  if (pageBrowserAllowed) return tools;
  return tools.filter((tool) => !PAGE_BROWSER_TOOL_NAMES.has(tool.name));
}
