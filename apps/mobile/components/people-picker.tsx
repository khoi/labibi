import type { SpaceMember } from "@labradoodle/contracts";
import { accountDisplay } from "@labradoodle/core";
import { useI18n } from "../lib/i18n";
import { PersonAvatar } from "./chat-avatar";
import { Checkmark } from "./row-accessories";
import { SettingsGroup, SettingsRow } from "./settings-group";

/** Workspace people with a checkmark on each one picked. */
export function PeoplePicker({
  people,
  selected,
  onChange,
  disabled,
}: {
  people: readonly SpaceMember[];
  selected: readonly string[];
  onChange: (selected: string[]) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <SettingsGroup>
      {people.map((person) => {
        const label = accountDisplay(person, t("Member")).label;
        const picked = selected.includes(person.userId);
        return (
          <SettingsRow
            key={person.userId}
            accessibilityRole="button"
            accessibilityState={{ selected: picked, disabled }}
            disabled={disabled}
            title={label}
            leading={<PersonAvatar person={person} size={32} />}
            trailing={picked ? <Checkmark /> : null}
            onPress={() =>
              onChange(
                picked
                  ? selected.filter((id) => id !== person.userId)
                  : [...selected, person.userId],
              )
            }
          />
        );
      })}
    </SettingsGroup>
  );
}
