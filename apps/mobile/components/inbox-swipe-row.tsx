import type { ReactElement } from "react";
import type { InboxRowAction } from "../lib/inbox-swipe";
import type { InboxChatPreviewProps } from "./inbox-chat-preview";

export type InboxSwipeRowProps = {
  rowKey: string;
  unread?: boolean;
  /** The long-press menu, in order. */
  menuActions: InboxRowAction[];
  preview: InboxChatPreviewProps;
  onAction: (action: InboxRowAction) => void;
  children: ReactElement;
};

/** Swipe actions and the context menu are iOS list behaviour. */
export function InboxSwipeRow({ children }: InboxSwipeRowProps) {
  return children;
}
