import type { Doodle, ModelCatalogEntry, ThinkingLevel } from "@labradoodle/contracts";
import { BUILTIN_TOOL_NAMES, isBuiltinToolName } from "@labradoodle/contracts";
import {
  chatModelChoices,
  connectedModelChoices,
  doodleModelSelection,
  parseModelOptionKey,
} from "@labradoodle/core";
import {
  Button,
  DoodleAvatar,
  NativeSelect,
  NativeSelectOption,
  SectionHeading,
} from "@labradoodle/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useId, useState } from "react";
import { InstructionSettings } from "../components/InstructionSettings";
import { thinkingLevelLabel } from "../lib/model-catalog";
import { useSpaceQueries } from "../lib/query";
import { useSpaceRpc } from "../lib/space-rpc";
import { errorText } from "../lib/user-error";
import { ChatModelPicker } from "./shell/chat-model-picker";

const NO_CREDENTIALS: never[] = [];
const NO_CATALOG: ModelCatalogEntry[] = [];

/**
 * The workspace's Doodle, for its owner: what it is told, which model and voice it uses, and the
 * tools it may not use. Everyone else never sees this.
 */
export function DoodleSettings() {
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const doodleQuery = useQuery({ ...queries.doodle.get.queryOptions(), refetchOnMount: "always" });
  const doodle = doodleQuery.data;
  if (!doodle?.canCustomize) return null;
  return (
    <DoodleSettingsForm
      key={doodle.id}
      doodle={doodle}
      onSaved={(next) => queryClient.setQueryData(queries.doodle.get.queryKey(), next)}
    />
  );
}

function DoodleSettingsForm({
  doodle,
  onSaved,
}: {
  doodle: Doodle;
  onSaved: (doodle: Doodle) => void;
}) {
  const { t } = useLingui();
  const ids = useId();
  const rpc = useSpaceRpc();
  const queries = useSpaceQueries();
  const refresh = { refetchOnMount: "always" } as const;
  const voices = useQuery({ ...queries.voice.voices.queryOptions({ input: {} }), ...refresh }).data;
  const credentials =
    useQuery({ ...queries.models.credentials.queryOptions(), ...refresh }).data ?? NO_CREDENTIALS;
  const catalog =
    useQuery({ ...queries.models.list.queryOptions(), ...refresh }).data ?? NO_CATALOG;
  const me = useQuery({ ...queries.me.queryOptions(), ...refresh }).data ?? null;
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(patch: Parameters<typeof rpc.doodle.update>[0]) {
    setSaving(true);
    setError(null);
    try {
      onSaved(await rpc.doodle.update(patch));
    } catch (err) {
      setError(errorText(err, t`Could not save`));
    } finally {
      setSaving(false);
    }
  }

  const {
    selectedKey: selectedModelKey,
    defaultEntry,
    thinkingLevels: thinkingOptions,
    defaultThinkingLevel,
  } = doodleModelSelection({
    saved: { provider: doodle.modelProvider, modelId: doodle.modelId },
    ownDefault: { provider: me?.defaultProvider, modelId: me?.defaultModel },
    catalog,
    credentials,
  });
  const modelChoices = chatModelChoices(
    connectedModelChoices(credentials, catalog),
    selectedModelKey,
    t`Account default`,
    defaultEntry?.images,
  );
  const disabledTools = doodle.disabledBuiltinTools;

  return (
    <section className="space-y-6" data-testid="doodle-settings">
      <SectionHeading variant="label" className="flex items-center gap-2">
        <DoodleAvatar size={22} />
        <Trans>Doodle</Trans>
      </SectionHeading>
      <InstructionSettings bot={doodle} onSaved={onSaved} />
      <Group label={t`Model`}>
        <label htmlFor={`${ids}-model`} className="sr-only">
          <Trans>Model</Trans>
        </label>
        <div className="min-w-0 w-full [&>div]:mt-0 [&>button]:mt-0">
          <ChatModelPicker
            id={`${ids}-model`}
            choices={modelChoices}
            value={selectedModelKey}
            onChange={(key) => {
              const model = key ? parseModelOptionKey(key) : null;
              void save({
                modelProvider: model?.provider ?? null,
                modelId: model?.modelId ?? null,
                thinkingLevel: null,
              });
            }}
          />
        </div>
        {thinkingOptions.length ? (
          <label
            htmlFor={`${ids}-thinking`}
            className="flex min-h-11 items-center justify-between gap-3 text-sm text-foreground"
          >
            <Trans>Thinking</Trans>
            <NativeSelect
              id={`${ids}-thinking`}
              className="max-w-2/3"
              value={doodle.thinkingLevel ?? ""}
              disabled={saving}
              onChange={(event) =>
                void save({
                  thinkingLevel: (event.target.value || null) as ThinkingLevel | null,
                })
              }
            >
              <NativeSelectOption value="">
                {t`Default (${thinkingLevelLabel(defaultThinkingLevel)})`}
              </NativeSelectOption>
              {thinkingOptions.map((level) => (
                <NativeSelectOption key={level} value={level}>
                  {thinkingLevelLabel(level)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
        ) : null}
      </Group>
      {voices?.length ? (
        <Group label={t`Voice`}>
          <label
            htmlFor={`${ids}-voice`}
            className="flex min-h-11 items-center justify-between gap-3 text-sm text-foreground"
          >
            <Trans>Voice</Trans>
            <NativeSelect
              id={`${ids}-voice`}
              className="max-w-2/3"
              value={doodle.voiceId ?? ""}
              disabled={saving}
              onChange={(event) => void save({ voiceId: event.target.value || null })}
            >
              <NativeSelectOption value="">{t`Account default`}</NativeSelectOption>
              {voices.map((voice) => (
                <NativeSelectOption key={voice.id} value={voice.id}>
                  {voice.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
        </Group>
      ) : null}
      <Group label={t`Tools`} plain>
        <div className="space-y-2" data-testid="doodle-settings-tools">
          <NativeSelect
            aria-label={t`Disable a tool`}
            value=""
            disabled={saving}
            onChange={(event) => {
              const name = event.target.value;
              if (!isBuiltinToolName(name) || disabledTools.includes(name)) return;
              void save({ disabledBuiltinTools: [...disabledTools, name] });
            }}
            className="w-full"
          >
            <NativeSelectOption value="">{t`Disable a tool`}</NativeSelectOption>
            {BUILTIN_TOOL_NAMES.filter((name) => !disabledTools.includes(name)).map((name) => (
              <NativeSelectOption key={name} value={name}>
                {humanizeTool(name)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {disabledTools.map((toolName) => (
            <div
              key={toolName}
              className="flex min-h-11 items-center justify-between gap-3 text-sm"
            >
              <span>{humanizeTool(toolName)}</span>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t`Enable ${humanizeTool(toolName)}`}
                title={t`Enable ${humanizeTool(toolName)}`}
                disabled={saving}
                onClick={() =>
                  void save({
                    disabledBuiltinTools: disabledTools.filter((entry) => entry !== toolName),
                  })
                }
              >
                <X className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      </Group>
      {error ? <p className="text-[13px] text-destructive">{error}</p> : null}
    </section>
  );
}

/** `plain` drops the card for a section whose single control already draws its own frame. */
function Group({
  label,
  plain = false,
  children,
}: {
  label: string;
  plain?: boolean;
  children: ReactNode;
}) {
  return (
    <section>
      <SectionHeading variant="label" className="mb-2">
        {label}
      </SectionHeading>
      <div className={`space-y-3 [&>*]:mt-0 ${plain ? "" : "rounded-xl bg-muted/50 p-4"}`}>
        {children}
      </div>
    </section>
  );
}

function humanizeTool(name: string) {
  const words = name.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
