import type { ReactElement } from "react";
import type { InboxRowAction } from "../lib/inbox-swipe";
import type { InboxChatPreviewProps } from "./inbox-chat-preview";

export type InboxSwipeRowProps = {
  rowKey: string;
  unread?: boolean;
  /** Bots only; groups have no finish notifications. */
  notifyOnFinish?: boolean;
  preview: InboxChatPreviewProps;
  onAction: (action: InboxRowAction) => void;
  onNotifyChange: (notifyOnFinish: boolean) => void;
  children: ReactElement;
};

/** Swipe actions and the context menu are iOS list behaviour. */
export function InboxSwipeRow({ children }: InboxSwipeRowProps) {
  return children;
}
