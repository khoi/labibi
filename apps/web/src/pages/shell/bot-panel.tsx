import type {
  AgentSkillCatalogEntry,
  Bot,
  ComputerMode,
  ModelCatalogEntry,
  ThinkingLevel,
} from "@labradoodle/contracts";
import {
  BOT_COMPUTER_MODES,
  BOT_NAME_MAX_LENGTH,
  BUILTIN_TOOL_NAMES,
  isBuiltinToolName,
} from "@labradoodle/contracts";
import {
  chatModelChoices,
  connectedModelChoices,
  credentialForModel,
  modelOptionKey,
  parseModelOptionKey,
  resolveSelectableModelId,
} from "@labradoodle/core";
import {
  BotAvatar,
  Button,
  Input,
  NativeSelect,
  NativeSelectOption,
  SectionHeading,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Toggle,
} from "@labradoodle/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { Download, Settings, X } from "lucide-react";
import type { ReactNode } from "react";
import { Suspense, useEffect, useId, useRef, useState } from "react";
import { ErrorBoundary, SectionLoadFailed } from "../../components/ErrorBoundary";
import { InstructionSettings } from "../../components/InstructionSettings";
import { PagesList } from "../../components/pages/PagesList";
import { thinkingLevelLabel } from "../../lib/model-catalog";
import { lazyComponent } from "../../lib/preload-recovery";
import { useSpaceQueries } from "../../lib/query";
import { errorText } from "../../lib/user-error";
import { ChatModelPicker } from "./chat-model-picker";

const KnowledgeSection = lazyComponent(() =>
  import("../KnowledgeSection").then((module) => module.KnowledgeSection),
);

const rowLabelClass = "text-sm text-foreground";

/** The advanced fields one Save sends, in the order their saved snapshot keeps them. */
function advancedValues(bot: Bot) {
  return [
    bot.modelProvider && bot.modelId ? modelOptionKey(bot.modelProvider, bot.modelId) : "",
    bot.thinkingLevel ?? "",
    bot.computerMode,
    bot.memoryScope,
    bot.autoSpeak,
    bot.voiceId ?? "",
  ] as const;
}

export function ComputerModePicker({
  value,
  onChange,
}: {
  value: ComputerMode;
  onChange: (value: ComputerMode) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {BOT_COMPUTER_MODES.map((mode) => (
        <Toggle
          key={mode}
          variant="outline"
          pressed={value === mode}
          onPressedChange={(pressed) => {
            if (pressed) onChange(mode);
          }}
          className="capitalize aria-pressed:border-foreground/40 aria-pressed:text-foreground"
        >
          {mode === "team" ? <Trans>Team</Trans> : <Trans>Private</Trans>}
        </Toggle>
      ))}
    </div>
  );
}

export type BotPanelTab = "computer" | "routines" | "pages" | "settings";

/** A bot's profile above its Computer, Routines, Pages and Advanced tabs. */
export function BotSettings({
  bot,
  tab = "settings",
  onTabChange,
  computer,
  routines,
  memoryProviderConfigured,
  onSave,
  onExport,
  onClear,
  focusModel = 0,
  onOpenConnections,
}: {
  bot: Bot;
  tab?: BotPanelTab;
  onTabChange?: (tab: BotPanelTab) => void;
  computer?: ReactNode;
  routines?: ReactNode;
  focusModel?: number;
  onOpenConnections?: () => void;
  /** Unused: the skill sections read and save the shared cached skill list. */
  onSkillsChange?: (skills: AgentSkillCatalogEntry[]) => void;
  memoryProviderConfigured: boolean;
  onSave: (patch: {
    name?: string;
    instructions?: string;
    notifyOnFinish?: boolean;
    computerMode?: ComputerMode;
    memoryScope?: "isolated" | "shared" | null;
    autoSpeak?: boolean;
    voiceId?: string | null;
    modelProvider?: string | null;
    modelId?: string | null;
    thinkingLevel?: ThinkingLevel | null;
    disabledBuiltinTools?: string[];
  }) => Promise<void>;
  onExport: () => Promise<void>;
  onClear: () => void;
}) {
  const { t } = useLingui();
  const ids = useId();
  const modelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusModel && tab === "settings") {
      modelRef.current?.scrollIntoView?.({ block: "nearest" });
      modelRef.current?.querySelector<HTMLElement>('[id$="-model"]')?.focus();
    }
  }, [tab, focusModel]);
  const [name, setName] = useState(bot.name);
  const savedNameRef = useRef(bot.name);
  const [notifyOnFinish, setNotifyOnFinish] = useState(bot.notifyOnFinish ?? true);
  const acceptedAutomatic = useRef({ notifyOnFinish: bot.notifyOnFinish ?? true });
  const automaticRevision = useRef({ notifyOnFinish: 0 });
  const [computerMode, setComputerMode] = useState(bot.computerMode);
  const [memoryScope, setMemoryScope] = useState(bot.memoryScope);
  const [autoSpeak, setAutoSpeak] = useState(bot.autoSpeak);
  const [voiceId, setVoiceId] = useState(bot.voiceId ?? "");
  const [modelKey, setModelKey] = useState(
    bot.modelProvider && bot.modelId ? modelOptionKey(bot.modelProvider, bot.modelId) : "",
  );
  const [thinkingLevel, setThinkingLevel] = useState(bot.thinkingLevel ?? "");
  const [disabledBuiltinTools, setDisabledBuiltinTools] = useState<string[]>(
    bot.disabledBuiltinTools ?? [],
  );
  // The list on screen is updated before the save returns. This stays on the
  // last list the server accepted so a rejection can undo that preview.
  const persistedDisabledToolsRef = useRef(disabledBuiltinTools);
  const serverDisabledToolsRef = useRef(disabledBuiltinTools);
  const pendingSavesRef = useRef(0);
  useEffect(() => {
    const next = bot.disabledBuiltinTools ?? [];
    if (serverDisabledToolsRef.current === next) return;
    serverDisabledToolsRef.current = next;
    persistedDisabledToolsRef.current = next;
    if (pendingSavesRef.current === 0) setDisabledBuiltinTools(next);
  }, [bot.disabledBuiltinTools]);
  // Shared with the model and voice settings, so a revisit paints at once and refreshes behind.
  const queries = useSpaceQueries();
  const refresh = { refetchOnMount: "always" } as const;
  const voices = useQuery({ ...queries.voice.voices.queryOptions({ input: {} }), ...refresh }).data;
  const credentialsQuery = useQuery({ ...queries.models.credentials.queryOptions(), ...refresh });
  const catalogQuery = useQuery({ ...queries.models.list.queryOptions(), ...refresh });
  const meQuery = useQuery({ ...queries.me.queryOptions(), ...refresh });
  const credentials = credentialsQuery.data ?? NO_CREDENTIALS;
  const catalog = catalogQuery.data ?? NO_CATALOG;
  const me = meQuery.data ?? null;
  // A failed catalog load must not clear an existing thinkingLevel override on save.
  const modelMetaReady =
    credentialsQuery.data !== undefined &&
    catalogQuery.data !== undefined &&
    meQuery.data !== undefined;
  const [saving, setSaving] = useState(false);
  const [savedAdvanced, setSavedAdvanced] = useState(() => JSON.stringify(advancedValues(bot)));
  const advancedSnapshot = JSON.stringify([
    modelKey,
    thinkingLevel,
    computerMode,
    memoryScope,
    autoSpeak,
    voiceId,
  ]);
  const dirty = name.trim() !== savedNameRef.current.trim() || advancedSnapshot !== savedAdvanced;
  const [error, setError] = useState<string | null>(null);
  const saveQueueRef = useRef(Promise.resolve());
  const executeSaveRef = useRef<
    (
      patchOverrides?: {
        name?: string;
        notifyOnFinish?: boolean;
        disabledBuiltinTools?: string[];
        baseDisabledBuiltinTools?: string[];
      },
      revisions?: { notifyOnFinish: number },
    ) => Promise<void>
  >(async () => undefined);
  // The panel can open on a cached bot. When a newer copy arrives, every field not edited since
  // follows it, so a later save does not send the cached values back over it. A copy that is not
  // newer (a roster read from before a save) is ignored.
  const shownBotRef = useRef(bot);
  useEffect(() => {
    if (bot.updatedAt <= shownBotRef.current.updatedAt) return;
    shownBotRef.current = bot;
    if (name.trim() === savedNameRef.current.trim()) setName(bot.name);
    savedNameRef.current = bot.name;
    const nextNotify = bot.notifyOnFinish ?? true;
    if (notifyOnFinish === acceptedAutomatic.current.notifyOnFinish) setNotifyOnFinish(nextNotify);
    acceptedAutomatic.current = { notifyOnFinish: nextNotify };
    const saved = JSON.parse(savedAdvanced) as unknown[];
    const next = advancedValues(bot);
    if (modelKey === saved[0]) setModelKey(next[0]);
    if (thinkingLevel === saved[1]) setThinkingLevel(next[1]);
    if (computerMode === saved[2]) setComputerMode(next[2]);
    if (memoryScope === saved[3]) setMemoryScope(next[3]);
    if (autoSpeak === saved[4]) setAutoSpeak(next[4]);
    if (voiceId === saved[5]) setVoiceId(next[5]);
    setSavedAdvanced(JSON.stringify(next));
  }, [bot]);

  const connectedOptions = connectedModelChoices(credentials, catalog);
  const storedModel = modelKey ? parseModelOptionKey(modelKey) : null;
  const selectedModel = storedModel
    ? {
        provider: storedModel.provider,
        modelId: resolveSelectableModelId(catalog, storedModel.provider, storedModel.modelId),
      }
    : null;
  const selectedModelKey = selectedModel
    ? modelOptionKey(selectedModel.provider, selectedModel.modelId)
    : "";

  const defaultEntry = me?.defaultModel
    ? catalogEntry(catalog, me.defaultProvider, me.defaultModel)
    : undefined;
  const modelChoices = chatModelChoices(
    connectedOptions,
    selectedModelKey,
    t`Space default`,
    defaultEntry?.images,
  );

  const effectiveProvider = selectedModel?.provider ?? me?.defaultProvider ?? null;
  const effectiveModelId = selectedModel?.modelId ?? me?.defaultModel ?? null;
  const effectiveEntry =
    effectiveProvider && effectiveModelId
      ? catalog.find(
          (entry) =>
            entry.provider === effectiveProvider &&
            resolveSelectableModelId(catalog, entry.provider, entry.id) === effectiveModelId,
        )
      : undefined;
  const effectiveCredential = credentialForModel(credentials, effectiveProvider, effectiveModelId);
  const thinkingOptions = (
    effectiveCredential?.thinkingLevels ??
    effectiveEntry?.thinkingLevels ??
    []
  ).filter((level) => level !== "off");
  const defaultThinkingLevel = effectiveCredential?.thinkingLevel ?? "medium";

  async function executeSave(
    patchOverrides?: {
      name?: string;
      notifyOnFinish?: boolean;
      disabledBuiltinTools?: string[];
      baseDisabledBuiltinTools?: string[];
    },
    revisions?: { notifyOnFinish: number },
  ) {
    try {
      setSaving(true);
      setError(null);
      const selected = selectedModel;
      const nextName = (patchOverrides?.name !== undefined ? patchOverrides.name : name).trim();
      const nextNotify =
        patchOverrides?.notifyOnFinish !== undefined
          ? patchOverrides.notifyOnFinish
          : notifyOnFinish;

      if (nextName) setName(nextName);
      const patch = {
        ...(nextName && nextName !== savedNameRef.current.trim() ? { name: nextName } : {}),
        notifyOnFinish: nextNotify,
        computerMode,
        memoryScope,
        autoSpeak,
        voiceId: voiceId || null,
        modelProvider: selected?.provider ?? null,
        modelId: selected?.modelId ?? null,
        ...(modelMetaReady &&
        (thinkingOptions.length > 0 ||
          (selected?.provider ?? null) !== bot.modelProvider ||
          (selected?.modelId ?? null) !== bot.modelId)
          ? {
              thinkingLevel: thinkingOptions.length
                ? ((thinkingLevel || null) as ThinkingLevel | null)
                : null,
            }
          : {}),
      };
      const requestedTools = patchOverrides?.disabledBuiltinTools;
      const baseTools = patchOverrides?.baseDisabledBuiltinTools ?? [];
      // Preserve this edit's additions/removals against any refreshed server list.
      // Retry if a refresh arrives while the request is in flight.
      for (;;) {
        const serverTools = serverDisabledToolsRef.current;
        const nextTools =
          requestedTools === undefined
            ? undefined
            : [
                ...persistedDisabledToolsRef.current.filter(
                  (name) => !baseTools.includes(name) || requestedTools.includes(name),
                ),
                ...requestedTools.filter(
                  (name) =>
                    !baseTools.includes(name) && !persistedDisabledToolsRef.current.includes(name),
                ),
              ];
        // Unrelated saves omit the list, preserving changes from other sessions.
        await onSave({
          ...patch,
          ...(nextTools !== undefined ? { disabledBuiltinTools: nextTools } : {}),
        });
        if (nextTools === undefined) break;
        if (
          serverTools !== serverDisabledToolsRef.current &&
          !sameStringList(nextTools, serverDisabledToolsRef.current)
        )
          continue;
        persistedDisabledToolsRef.current = nextTools;
        break;
      }
      acceptedAutomatic.current = { notifyOnFinish: nextNotify };
      if (nextName) savedNameRef.current = nextName;
      setSavedAdvanced(
        JSON.stringify([modelKey, thinkingLevel, computerMode, memoryScope, autoSpeak, voiceId]),
      );
    } catch (err) {
      if (
        patchOverrides?.notifyOnFinish !== undefined &&
        revisions?.notifyOnFinish === automaticRevision.current.notifyOnFinish
      )
        setNotifyOnFinish(acceptedAutomatic.current.notifyOnFinish);
      setError(errorText(err, t`Could not save`));
    } finally {
      pendingSavesRef.current -= 1;
      if (pendingSavesRef.current === 0) {
        setDisabledBuiltinTools([...persistedDisabledToolsRef.current]);
      }
      setSaving(pendingSavesRef.current > 0);
    }
  }
  executeSaveRef.current = executeSave;

  function disableBuiltinTool(raw: string) {
    const name = raw.trim();
    if (!name) return;
    if (!isBuiltinToolName(name)) return;
    setError(null);
    if (disabledBuiltinTools.includes(name)) return;
    const next = [...disabledBuiltinTools, name];
    setDisabledBuiltinTools(next);
    void enqueueSave({ disabledBuiltinTools: next });
  }

  function enqueueSave(patchOverrides?: {
    name?: string;
    notifyOnFinish?: boolean;
    disabledBuiltinTools?: string[];
  }) {
    // Serialize full-object auto-saves so an older in-flight request cannot
    // finish after a newer one and clobber fields. Always call through a ref so
    // queued work reads the latest field values, not a stale render closure.
    pendingSavesRef.current += 1;
    if (patchOverrides?.notifyOnFinish !== undefined) automaticRevision.current.notifyOnFinish += 1;
    const revisions = { ...automaticRevision.current };
    const queuedPatch =
      patchOverrides?.disabledBuiltinTools === undefined
        ? patchOverrides
        : {
            ...patchOverrides,
            baseDisabledBuiltinTools: [...persistedDisabledToolsRef.current],
          };
    saveQueueRef.current = saveQueueRef.current
      .catch(() => undefined)
      .then(() => executeSaveRef.current(queuedPatch, revisions));
    return saveQueueRef.current;
  }

  return (
    <div data-testid="bot-settings">
      <div data-testid="bot-profile-header" className="flex flex-col items-center pb-5 text-center">
        <div className="flex justify-center pb-4">
          <BotAvatar color={bot.color} identity={bot.id} status={bot.status} size={76} />
        </div>
        <InlineProfileField
          label={t`Name`}
          editLabel={t`Edit name`}
          value={name}
          maxLength={BOT_NAME_MAX_LENGTH}
          className="text-xl font-semibold"
          onCommit={(value) => {
            if (!value.trim()) return;
            setName(value.trim());
            void enqueueSave({ name: value });
          }}
        />
      </div>
      <Tabs value={tab} onValueChange={(next) => onTabChange?.(next as BotPanelTab)}>
        <TabsList className="w-full">
          <TabsTrigger value="computer">
            <Trans>Computer</Trans>
          </TabsTrigger>
          <TabsTrigger value="routines">
            <Trans>Routines</Trans>
          </TabsTrigger>
          <TabsTrigger value="pages">
            <Trans>Pages</Trans>
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Trans>Advanced</Trans>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="computer" className="pt-4">
          {computer}
        </TabsContent>
        <TabsContent value="routines" className="pt-4">
          {routines}
        </TabsContent>
        <TabsContent value="pages" className="pt-4">
          {tab === "pages" ? <PagesList botId={bot.id} /> : null}
        </TabsContent>
        {/* Stays mounted so knowledge drafts survive a tab switch. */}
        <TabsContent value="settings" keepMounted data-testid="bot-settings-advanced">
          <section className="mt-6">
            <SectionHeading variant="label" className="mb-2">
              <Trans>Notifications</Trans>
            </SectionHeading>
            <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 p-4">
              <div>
                <label
                  htmlFor={`${ids}-notify-finish`}
                  id={`${ids}-notify-finish-label`}
                  className="text-sm"
                >
                  <Trans>When it finishes or needs input</Trans>
                </label>
              </div>
              <Switch
                id={`${ids}-notify-finish`}
                checked={notifyOnFinish}
                aria-labelledby={`${ids}-notify-finish-label`}
                onCheckedChange={(checked) => {
                  setNotifyOnFinish(checked);
                  void enqueueSave({ notifyOnFinish: checked });
                }}
              />
            </div>
          </section>
          <ErrorBoundary fallback={<SectionLoadFailed />}>
            <Suspense fallback={null}>
              <KnowledgeSection botId={bot.id} />
            </Suspense>
          </ErrorBoundary>
          <div className="space-y-6 pt-6">
            <div ref={modelRef}>
              <div className="mb-2 flex items-center justify-between text-xs font-medium text-muted-foreground pe-1">
                <Trans>Model</Trans>
                {onOpenConnections ? (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t`Model connections`}
                    onClick={onOpenConnections}
                  >
                    <Settings className="size-4" />
                  </Button>
                ) : null}
              </div>
              <div className="rounded-xl bg-muted/50 p-4 space-y-3">
                <div className="flex min-h-11 items-center justify-between gap-3">
                  <label htmlFor={`${ids}-model`} className="sr-only">
                    <Trans>Model</Trans>
                  </label>
                  <div className="min-w-0 w-full [&>div]:mt-0 [&>button]:mt-0">
                    <ChatModelPicker
                      id={`${ids}-model`}
                      choices={modelChoices}
                      value={selectedModelKey}
                      onChange={(key) => {
                        setModelKey(key);
                        setThinkingLevel("");
                      }}
                    />
                  </div>
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
                      value={thinkingLevel}
                      onChange={(event) => setThinkingLevel(event.target.value)}
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
              </div>
            </div>
            <SettingsGroup label={t`Computer`} plain>
              <ComputerModePicker value={computerMode} onChange={setComputerMode} />
              {memoryProviderConfigured ? (
                <div className="mt-4 text-sm text-foreground">
                  <Trans>Memory scope</Trans>
                  <div className="mt-2 flex gap-2">
                    {(
                      [
                        { value: null, label: t`Inherit default` },
                        { value: "isolated" as const, label: t`Isolated` },
                        { value: "shared" as const, label: t`Shared` },
                      ] satisfies Array<{ value: "isolated" | "shared" | null; label: string }>
                    ).map((option) => (
                      <Toggle
                        key={option.label}
                        variant="outline"
                        size="sm"
                        pressed={memoryScope === option.value}
                        onPressedChange={(pressed) => {
                          if (pressed) setMemoryScope(option.value);
                        }}
                        className="flex-1 aria-pressed:border-foreground/40 aria-pressed:text-foreground"
                      >
                        {option.label}
                      </Toggle>
                    ))}
                  </div>
                </div>
              ) : null}
            </SettingsGroup>
            <SettingsGroup label={t`Voice`}>
              <label
                htmlFor={`${ids}-auto-speak`}
                className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm text-foreground"
              >
                <span className={rowLabelClass}>
                  <Trans>Read replies aloud</Trans>
                </span>
                <Switch
                  id={`${ids}-auto-speak`}
                  checked={autoSpeak}
                  onCheckedChange={(checked) => setAutoSpeak(checked)}
                />
              </label>
              {voices?.length ? (
                <label
                  htmlFor={`${ids}-voice`}
                  className="flex min-h-11 items-center justify-between gap-3 text-sm text-foreground"
                >
                  <Trans>Voice</Trans>
                  <NativeSelect
                    id={`${ids}-voice`}
                    className="max-w-2/3"
                    value={voiceId}
                    onChange={(event) => setVoiceId(event.target.value)}
                  >
                    <NativeSelectOption value="">{t`Account default`}</NativeSelectOption>
                    {voices.map((voice) => (
                      <NativeSelectOption key={voice.id} value={voice.id}>
                        {voice.label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </label>
              ) : null}
            </SettingsGroup>
            <InstructionSettings key={bot.id} bot={bot} />
            <SettingsGroup label={t`Tools`} plain>
              <section data-testid="bot-settings-tools">
                <div className="space-y-2 [&>*]:mt-0">
                  <div>
                    <NativeSelect
                      id={`${ids}-disabled-tools`}
                      aria-label={t`Disable a tool`}
                      value=""
                      onChange={(event) => disableBuiltinTool(event.target.value)}
                      className="w-full"
                    >
                      <NativeSelectOption value="">{t`Disable a tool`}</NativeSelectOption>
                      {BUILTIN_TOOL_NAMES.filter(
                        (name) => !disabledBuiltinTools.includes(name),
                      ).map((name) => (
                        <NativeSelectOption key={name} value={name}>
                          {humanizeTool(name)}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </div>
                  {disabledBuiltinTools.map((toolName) => (
                    <div
                      key={toolName}
                      className="flex min-h-11 items-center justify-between gap-3 text-sm"
                    >
                      <span>{humanizeTool(toolName)}</span>
                      <Button
                        id={`${ids}-disabled-${toolName}`}
                        variant="ghost"
                        size="icon-xs"
                        aria-label={t`Enable ${humanizeTool(toolName)}`}
                        title={t`Enable ${humanizeTool(toolName)}`}
                        onClick={() => {
                          const next = disabledBuiltinTools.filter((entry) => entry !== toolName);
                          setDisabledBuiltinTools(next);
                          void enqueueSave({ disabledBuiltinTools: next });
                        }}
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </section>
            </SettingsGroup>
            <div className="overflow-hidden rounded-xl bg-muted/50 px-4">
              <button
                type="button"
                className="flex min-h-12 w-full items-center justify-between text-sm"
                onClick={() => {
                  setError(null);
                  onExport().catch((err: unknown) => setError(errorText(err)));
                }}
              >
                <Trans>Export</Trans>
                <Download className="size-4 text-muted-foreground" />
              </button>
              <button
                type="button"
                className="min-h-12 w-full border-t border-border text-start text-sm text-destructive"
                onClick={onClear}
              >
                <Trans>Clear conversation</Trans>
              </button>
            </div>
          </div>
          {dirty ? (
            <Button
              className="sticky bottom-0 mt-5 w-full"
              disabled={saving}
              onClick={() => {
                void enqueueSave({ name, notifyOnFinish });
              }}
            >
              <Trans>Save</Trans>
            </Button>
          ) : null}
        </TabsContent>
      </Tabs>
      {error ? <p className="mt-2 text-[13px] text-destructive">{error}</p> : null}
    </div>
  );
}

const NO_CREDENTIALS: never[] = [];
const NO_CATALOG: ModelCatalogEntry[] = [];

function sameStringList(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function catalogEntry(
  catalog: ModelCatalogEntry[],
  provider: string | null | undefined,
  modelId: string,
) {
  if (!provider) return undefined;
  return catalog.find((entry) => entry.provider === provider && entry.id === modelId);
}

function InlineProfileField({
  label,
  editLabel,
  value,
  maxLength,
  className,
  onCommit,
}: {
  label: string;
  editLabel: string;
  value: string;
  maxLength: number;
  className: string;
  onCommit: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const cancelled = useRef(false);
  function commit() {
    if (cancelled.current) return;
    setEditing(false);
    if (draft.trim() !== value.trim()) onCommit(draft);
  }
  return editing ? (
    <Input
      autoFocus
      aria-label={label}
      value={draft}
      maxLength={maxLength}
      className={`h-auto border-transparent bg-transparent p-0 text-center shadow-none ${className}`}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) {
          if (event.key === "Escape") event.stopPropagation();
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
        if (event.key === "Escape") {
          cancelled.current = true;
          setEditing(false);
        }
      }}
    />
  ) : (
    <button
      type="button"
      aria-label={editLabel}
      className={`min-w-0 max-w-full cursor-text break-words rounded px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
      onClick={() => {
        cancelled.current = false;
        setDraft(value);
        setEditing(true);
      }}
    >
      {value}
    </button>
  );
}

/** `plain` drops the card for a section whose single control already draws its own frame. */
function SettingsGroup({
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
