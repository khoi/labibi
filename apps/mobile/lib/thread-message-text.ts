import { previewMessageText as previewText } from "@labradoodle/core";
import type { MobileMessage } from "./api";
import { t } from "./i18n";

export function previewMessageText(message: MobileMessage): string {
  return previewText(message, {
    photo: t("Photo"),
    attachment: t("Attachment"),
    message: t("Message"),
  });
}
