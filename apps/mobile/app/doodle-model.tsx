import type { ChatModelChoice } from "@labradoodle/core";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ModelPickerList } from "../components/model-picker-list";
import { rpc } from "../lib/api";
import { doodleModelPickerChoices } from "../lib/doodle-model";
import { useI18n } from "../lib/i18n";
import { errorText } from "../lib/user-error";

/** The searchable list of models for Doodle, when there are too many for a menu. */
export default function DoodleModelScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { value = "" } = useLocalSearchParams<{ value?: string }>();
  const [choices, setChoices] = useState<ChatModelChoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void Promise.all([rpc("me"), rpc("models/list"), rpc("models/credentials")])
      .then(([me, catalog, credentials]) =>
        setChoices(doodleModelPickerChoices(me, catalog, credentials, value, t)),
      )
      .catch((err) => setError(errorText(err, t("Could not load model settings"))));
  }, [t, value]);

  return (
    <ModelPickerList
      choices={choices}
      selectedKey={value}
      error={error}
      onSelect={(item) =>
        router.dismissTo({ pathname: "/doodle-settings", params: { model: item.key } })
      }
    />
  );
}
