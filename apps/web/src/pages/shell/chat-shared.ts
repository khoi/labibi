import type { ThreadMessage } from "@labradoodle/contracts";
import { previewMessageText as previewText } from "@labradoodle/core";
import { t } from "@lingui/core/macro";

export type PendingAttachment = {
  id: string;
  threadKey: string;
  file: File;
  previewUrl?: string;
};

export function previewMessageText(message: ThreadMessage): string {
  return previewText(message, { photo: t`Photo`, attachment: t`Attachment`, message: t`Message` });
}
