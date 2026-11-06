import type { ChatModelChoice } from "@labradoodle/core";
import { chatModelChoices, connectedModelChoices } from "@labradoodle/core";
import type { MobileMe, MobileModel, MobileModelCredential } from "./api";

/**
 * What Doodle's model picker lists. Default leaves the model to each person who asks, so it is
 * named after the owner's own default.
 */
export function doodleModelPickerChoices(
  me: MobileMe | null,
  catalog: MobileModel[],
  credentials: MobileModelCredential[],
  selectedKey: string,
  t: (message: string) => string,
): ChatModelChoice[] {
  const defaultEntry =
    me?.defaultModel && me.defaultProvider
      ? catalog.find(
          (entry) => entry.provider === me.defaultProvider && entry.id === me.defaultModel,
        )
      : undefined;
  const choices = chatModelChoices(
    connectedModelChoices(credentials, catalog),
    selectedKey,
    t("Default"),
    defaultEntry?.images,
  );
  choices[0] = {
    ...choices[0]!,
    title: t("Default"),
    detail: me?.defaultModel ? (defaultEntry?.label ?? me.defaultModel) : undefined,
  };
  return choices;
}
