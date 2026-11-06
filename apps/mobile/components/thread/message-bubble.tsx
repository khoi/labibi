import { MarkdownLongPressContext } from "@labradoodle/chat-ui/native";
import type { LoginFieldInput, MessageBlock } from "@labradoodle/contracts";
import { artifactPreviewKind, isAttachmentAudioMimeType } from "@labradoodle/contracts";
import {
  DOODLE_NAME,
  formatFileSize,
  isApprovalAskBlock,
  selectedAskActionLabel,
} from "@labradoodle/core";
import { fontWeight, typeScale } from "@labradoodle/ui-tokens";
import type { ComponentProps } from "react";
import { memo, useMemo } from "react";
import type { TextProps } from "react-native";
import { Alert, Pressable, Text, View } from "react-native";
import type { MobileMessage } from "../../lib/api";
import { blockText } from "../../lib/api";
import { mobileTokens } from "../../lib/appearance";
import type { MobileArtifactTarget } from "../../lib/artifact-open";
import { openMobileArtifact } from "../../lib/artifact-open";
import { allowsWorkspace } from "../../lib/ask-action-label";
import { plainAskTitle } from "../../lib/ask-title";
import { DOODLE_SPEAKER } from "../../lib/doodle";
import { t, useI18n } from "../../lib/i18n";
import { isInlineImageBlock } from "../../lib/inline-image";
import type { UserMentionTarget } from "../../lib/message-mentions";
import { UserMentionsContext } from "../../lib/message-mentions";
import { messagePresentationSegments } from "../../lib/message-presentation";
import { useResolvedAppearance } from "../../lib/native";
import type { UserBubble } from "../../lib/user-bubble";
import { withUserBubble } from "../../lib/user-bubble";
import { errorText } from "../../lib/user-error";
import { AppConnectCard } from "../AppConnectCard";
import { AskActions } from "../AskActions";
import { AudioAttachment } from "../audio-attachment";
import { ChoiceCard } from "../ChoiceCard";
import { ComputerCard } from "../ComputerCard";
import { ChangeUndo, isUndoableChange } from "../change-undo";
import type { ImageArtifactPreviewTarget } from "../image-artifact-viewer";
import { InlineImageAttachment } from "../inline-image-attachment";
import { McpApprovalCard } from "../McpApprovalCard";
import { MessageCaption } from "../message-caption";
import { PageCard } from "../pages/page-card";
import { AskBlock } from "./ask-block";
import { McpAppCard } from "./mcp-app-card";
import type { MessageRowActions } from "./message-row";
import { isSpecialMessageBlock, SpecialMessageCard } from "./special-message-card";

type AskAction = NonNullable<Extract<MessageBlock, { kind: "ask" }>["actions"]>[number];

function formatApprovalAnswer(
  answer: string | undefined,
  actions: AskAction[] | undefined,
  approval: boolean,
): string {
  if (!answer) return t("Answered");
  if (approval && answer === "allow")
    return allowsWorkspace(actions) ? t("Allowed in this workspace") : t("Allowed once");
  if (approval && answer === "always") return t("Always allowed");
  if (approval && answer === "deny") return t("Denied");
  return t("Answered: {answer}", { answer: selectedAskActionLabel(answer, actions) });
}

export type MessageActionProps = Pick<
  TextProps,
  "onLongPress" | "accessibilityActions" | "onAccessibilityAction"
>;

export const MessageBubble = memo(function MessageBubble(
  props: ComponentProps<typeof MessageBubbleContent>,
) {
  const { mentionTargets } = props;
  const userMentions = useMemo(
    () => (mentionTargets.length ? { targets: mentionTargets } : undefined),
    [mentionTargets],
  );
  const body = (
    <MarkdownLongPressContext.Provider value={props.actionProps.onLongPress}>
      <MessageBubbleBody {...props} />
    </MarkdownLongPressContext.Provider>
  );
  return props.message.role === "user" && userMentions ? (
    <UserMentionsContext.Provider value={userMentions}>{body}</UserMentionsContext.Provider>
  ) : (
    body
  );
});

/** Blocks drawn as their own card between the message's text pieces. */
function isOwnCardBlock(block: MessageBlock): boolean {
  return isSpecialMessageBlock(block) || block.kind === "page" || block.kind === "app";
}

function MessageBubbleBody(props: ComponentProps<typeof MessageBubbleContent>) {
  const { message } = props;
  if (!message.blocks.some(isOwnCardBlock)) return <MessageBubbleContent {...props} />;

  const pieces: MessageBlock[][] = [];
  for (const block of message.blocks) {
    const previous = pieces.at(-1);
    if (isOwnCardBlock(block) || !previous || isOwnCardBlock(previous[0]!)) {
      pieces.push([block]);
    } else {
      previous.push(block);
    }
  }
  const content = pieces.map((blocks, index) => {
    const first = blocks[0]!;
    if (first.kind === "page")
      return <PageCard key={`page-${index}`} block={first} messageId={message.id} />;
    if (first.kind === "app")
      return (
        <McpAppCard
          key={`app-${index}`}
          block={first}
          target={{ threadId: props.threadId ?? "" }}
        />
      );
    return isSpecialMessageBlock(first) ? (
      <SpecialMessageCard
        key={first.kind === "subagent" ? first.agentId : `${first.kind}-${index}`}
        special={first}
        actionProps={props.actionProps}
        onHelperToggle={props.onHelperToggle}
        userBubble={props.userBubble}
      />
    ) : (
      <MessageBubbleContent
        {...props}
        key={`content-${index}`}
        message={{ ...message, blocks }}
        onAnswer={(_, ...answer) => props.onAnswer(message, ...answer)}
      />
    );
  });
  return content.length === 1 ? (
    content[0]
  ) : (
    <View style={{ gap: 8, width: "100%" }}>{content}</View>
  );
}

const MessageBubbleContent = memo(function MessageBubbleContent({
  threadId,
  authorName,
  showBotSenderName,
  message,
  canAnswer,
  canDismiss,
  onAnswer,
  onOpenComputer,
  onChoiceDismissed,
  onPreviewFile,
  onPreviewImage,
  actionProps,
  doubleTapSurface = false,
  userBubble,
}: {
  onHelperToggle?: MessageRowActions["helperToggle"];
  threadId?: string;
  /** Someone else in the chat wrote this message: named and set apart. */
  authorName?: string;
  showBotSenderName: boolean;
  /** Who a sent message's `@Name` can refer to. */
  mentionTargets: readonly UserMentionTarget[];
  message: MobileMessage;
  canAnswer: boolean;
  canDismiss: boolean;
  onAnswer: (
    message: MobileMessage,
    answer: string,
    fields?: readonly LoginFieldInput[],
    dismiss?: boolean,
    remember?: false,
  ) => Promise<void>;
  onOpenComputer: () => void;
  onChoiceDismissed?: (question: string) => void;
  /** Opens a file the app can show; other types go to the share sheet. */
  onPreviewFile: (artifactId: string) => void;
  onPreviewImage: (target: ImageArtifactPreviewTarget) => void;
  actionProps: MessageActionProps;
  doubleTapSurface?: boolean;
  userBubble?: UserBubble;
}) {
  const colorScheme = useResolvedAppearance();
  const tokens = withUserBubble(mobileTokens(), userBubble);
  const { t } = useI18n();
  const outgoing = message.role === "user" && !authorName;
  const artifactTarget: MobileArtifactTarget = { threadId: threadId ?? message.threadId ?? "" };
  const appConnectBlocks = message.blocks.filter(
    (block): block is Extract<MessageBlock, { kind: "app_connect" }> =>
      block.kind === "app_connect",
  );
  const mcpApprovalBlocks = message.blocks.filter(
    (block): block is Extract<MessageBlock, { kind: "mcp_approval" }> =>
      block.kind === "mcp_approval",
  );
  const undoBlock = message.blocks.find(isUndoableChange);
  if (undoBlock?.kind === "ask") return <ChangeUndo block={undoBlock} />;
  const ask = message.blocks.find(
    (block): block is Extract<MessageBlock, { kind: "ask" }> =>
      block.kind === "ask" && !isApprovalAskBlock(block) && !block.actions?.length,
  );
  if (ask) {
    return (
      <View style={{ gap: 8, width: "100%" }}>
        <AskBlock
          ask={ask}
          actionProps={actionProps}
          canAnswer={canAnswer}
          canDismiss={canDismiss}
          onAnswer={(answer, fields, remember) =>
            onAnswer(message, answer, fields, undefined, remember)
          }
          onDismiss={() => onAnswer(message, "", undefined, true)}
        />
        {appConnectBlocks.map((block, index) => (
          <AppConnectCard
            key={`${block.provider}-${index}`}
            threadId={message.threadId}
            messageId={message.id}
            block={block}
            accessibilityActions={actionProps.accessibilityActions}
            onAccessibilityAction={actionProps.onAccessibilityAction}
          />
        ))}
        {mcpApprovalBlocks.map((block) => (
          <McpApprovalCard
            key={block.serverId}
            threadId={message.threadId}
            block={block}
            accessibilityActions={actionProps.accessibilityActions}
            onAccessibilityAction={actionProps.onAccessibilityAction}
          />
        ))}
      </View>
    );
  }
  const inlineCardCount = appConnectBlocks.length + mcpApprovalBlocks.length;
  if (inlineCardCount > 0 && inlineCardCount === message.blocks.length) {
    return (
      <View style={{ gap: 8, width: "100%" }}>
        {appConnectBlocks.map((block, index) => (
          <AppConnectCard
            key={`${block.provider}-${index}`}
            threadId={message.threadId}
            messageId={message.id}
            block={block}
            accessibilityActions={actionProps.accessibilityActions}
            onAccessibilityAction={actionProps.onAccessibilityAction}
          />
        ))}
        {mcpApprovalBlocks.map((block) => (
          <McpApprovalCard
            key={block.serverId}
            threadId={message.threadId}
            block={block}
            accessibilityActions={actionProps.accessibilityActions}
            onAccessibilityAction={actionProps.onAccessibilityAction}
          />
        ))}
      </View>
    );
  }
  const askBlock = message.blocks.find(
    (block) => block.kind === "ask" && Boolean(block.actions?.length),
  );
  if (askBlock?.kind === "ask" && askBlock.actions?.length) {
    return (
      <View style={{ gap: 8, width: "100%" }}>
        <View
          style={{
            // No percentage width: the iOS menu host has no definite width to resolve it against.
            maxWidth: 576,
            borderRadius: 18,
            backgroundColor: tokens.card,
            paddingHorizontal: 16,
            paddingVertical: 14,
          }}
        >
          {isUndoableChange(askBlock) ? (
            <ChangeUndo block={askBlock} />
          ) : (
            <>
              {askBlock.text ? (
                <Text {...actionProps} style={{ color: tokens.foreground, ...typeScale.cardTitle }}>
                  {askBlock.instructionUpdate
                    ? t("Update instructions?")
                    : plainAskTitle(askBlock.text)}
                </Text>
              ) : null}
              {askBlock.detail ? (
                <Text
                  {...(askBlock.text ? {} : actionProps)}
                  style={{
                    color:
                      askBlock.detailFormat === "text" ? tokens.foreground : tokens.mutedForeground,
                    marginTop: askBlock.text ? 8 : 0,
                    // Commands and an approval's tool arguments read as code; a bot's own note
                    // under its question is text.
                    ...(askBlock.detailFormat === "code" ||
                    (!askBlock.detailFormat && askBlock.approvalEffectId)
                      ? { ...typeScale.caption, fontFamily: "Menlo" }
                      : typeScale.secondary),
                  }}
                >
                  {askBlock.detail}
                </Text>
              ) : null}
              {askBlock.status === "answered" ? (
                <Text
                  {...actionProps}
                  style={{
                    color: askBlock.answer === "deny" ? tokens.mutedForeground : tokens.success,
                    marginTop: 12,
                    ...typeScale.secondary,
                    fontWeight: fontWeight.medium,
                  }}
                >
                  {askBlock.instructionUpdate
                    ? t(askBlock.answer === "deny" ? "Dismissed" : "Allowed once")
                    : formatApprovalAnswer(
                        askBlock.answer,
                        askBlock.actions,
                        isApprovalAskBlock(askBlock),
                      )}
                </Text>
              ) : canAnswer && onAnswer ? (
                <AskActions
                  actions={askBlock.actions}
                  site={askBlock.site}
                  approval={isApprovalAskBlock(askBlock)}
                  instructions={askBlock.instructionUpdate?.after}
                  accessibilityActions={actionProps.accessibilityActions}
                  onAccessibilityAction={actionProps.onAccessibilityAction}
                  onAnswer={(answer) => onAnswer(message, answer)}
                />
              ) : (
                <Text
                  {...actionProps}
                  style={{ color: tokens.mutedForeground, marginTop: 12, ...typeScale.caption }}
                >
                  {t("No longer active")}
                </Text>
              )}
            </>
          )}
        </View>
        {appConnectBlocks.map((block, index) => (
          <AppConnectCard
            key={`${block.provider}-${index}`}
            threadId={message.threadId}
            messageId={message.id}
            block={block}
            accessibilityActions={actionProps.accessibilityActions}
            onAccessibilityAction={actionProps.onAccessibilityAction}
          />
        ))}
        {mcpApprovalBlocks.map((block) => (
          <McpApprovalCard
            key={block.serverId}
            threadId={message.threadId}
            block={block}
            accessibilityActions={actionProps.accessibilityActions}
            onAccessibilityAction={actionProps.onAccessibilityAction}
          />
        ))}
      </View>
    );
  }
  const attachments = message.blocks.filter(
    (block) => block.kind === "image" || block.kind === "file",
  );
  const caption = message.blocks
    .flatMap((block) => (block.kind === "text" && block.text ? [block.text] : []))
    .join("\n");
  if (attachments.length > 0) {
    const speaker = message.role === "bot" ? DOODLE_NAME : authorName;
    const speakerColor = message.role === "bot" ? DOODLE_SPEAKER.color : undefined;
    const hasInlineImages = attachments.some(isInlineImageBlock);
    const bubbleStyle = {
      maxWidth: "100%",
      borderRadius: 20,
      backgroundColor: outgoing ? tokens.chatUser : tokens.muted,
      paddingHorizontal: 14,
      paddingVertical: 12,
      gap: 8,
    } as const;
    return (
      <View style={hasInlineImages ? { maxWidth: "100%", gap: 8 } : bubbleStyle}>
        {((showBotSenderName || authorName) && speaker) || caption ? (
          <View style={hasInlineImages ? bubbleStyle : undefined}>
            {(showBotSenderName || authorName) && speaker ? (
              <Text
                style={{ color: speakerColor ?? tokens.mutedForeground, ...typeScale.footnote }}
              >
                {speaker}
              </Text>
            ) : null}
            {caption ? (
              <MessageCaption
                role={message.role}
                received={!outgoing}
                text={caption}
                tokens={tokens}
                colorScheme={colorScheme}
                streaming={message.id.startsWith("progress:")}
              />
            ) : null}
          </View>
        ) : null}
        {attachments.map((attachment, index) => (
          <View
            key={`${attachment.artifactId ?? attachment.name ?? attachment.kind}-${index}`}
            style={hasInlineImages && !isInlineImageBlock(attachment) ? bubbleStyle : undefined}
          >
            {attachment.kind === "image" ? (
              isInlineImageBlock(attachment) ? (
                <InlineImageAttachment
                  threadTarget={artifactTarget}
                  artifactId={attachment.artifactId}
                  name={attachment.name ?? t("Image")}
                  mimeType={attachment.mimeType ?? "image/png"}
                  labelColor={outgoing ? tokens.chatUserForeground : tokens.foreground}
                  pressableProps={actionProps}
                  onOpen={() =>
                    onPreviewImage({
                      artifactId: attachment.artifactId!,
                      name: attachment.name ?? t("Image"),
                      mimeType: attachment.mimeType ?? "image/png",
                    })
                  }
                />
              ) : (
                <Pressable
                  {...actionProps}
                  onPress={() =>
                    attachment.artifactId
                      ? void openMobileArtifact(
                          artifactTarget,
                          attachment.artifactId,
                          attachment.name ?? t("Image"),
                          attachment.mimeType ?? "image/png",
                        ).catch((err) =>
                          Alert.alert(t("Could not open image"), errorText(err, t("Try again."))),
                        )
                      : undefined
                  }
                >
                  <Text
                    style={{
                      color: outgoing ? tokens.chatUserForeground : tokens.foreground,
                      fontSize: 15,
                    }}
                  >
                    🖼 {attachment.name ?? t("Image")}
                  </Text>
                </Pressable>
              )
            ) : attachment.artifactId && isAttachmentAudioMimeType(attachment.mimeType ?? "") ? (
              <AudioAttachment
                pressableProps={actionProps}
                target={artifactTarget}
                artifactId={attachment.artifactId}
                name={attachment.name ?? t("File")}
                mimeType={attachment.mimeType!}
                labelColor={outgoing ? tokens.chatUserForeground : undefined}
              />
            ) : (
              <Pressable
                {...actionProps}
                onPress={() =>
                  attachment.artifactId
                    ? artifactPreviewKind(attachment.mimeType ?? "") !== "none"
                      ? onPreviewFile(attachment.artifactId)
                      : void openMobileArtifact(
                          artifactTarget,
                          attachment.artifactId,
                          attachment.name ?? t("File"),
                          attachment.mimeType ?? "text/plain",
                        ).catch((err) =>
                          Alert.alert(t("Could not open file"), errorText(err, t("Try again."))),
                        )
                    : undefined
                }
              >
                <Text
                  style={{
                    color: outgoing ? tokens.chatUserForeground : tokens.foreground,
                    fontSize: 15,
                  }}
                >
                  📎 {attachment.name ?? t("File")}
                </Text>
                {formatFileSize(attachment.size) ? (
                  <Text
                    style={{
                      color: outgoing ? tokens.chatUserForeground : tokens.mutedForeground,
                      marginTop: 4,
                      fontSize: 13,
                    }}
                  >
                    {formatFileSize(attachment.size)}
                  </Text>
                ) : null}
              </Pressable>
            )}
          </View>
        ))}
        {appConnectBlocks.map((block, index) => (
          <AppConnectCard
            key={`${block.provider}-${index}`}
            threadId={message.threadId}
            messageId={message.id}
            block={block}
            accessibilityActions={actionProps.accessibilityActions}
            onAccessibilityAction={actionProps.onAccessibilityAction}
          />
        ))}
        {mcpApprovalBlocks.map((block) => (
          <McpApprovalCard
            key={block.serverId}
            threadId={message.threadId}
            block={block}
            accessibilityActions={actionProps.accessibilityActions}
            onAccessibilityAction={actionProps.onAccessibilityAction}
          />
        ))}
      </View>
    );
  }
  const segments = messagePresentationSegments(message.blocks);
  const speaker = message.role === "bot" ? DOODLE_NAME : authorName;
  const speakerColor = message.role === "bot" ? DOODLE_SPEAKER.color : undefined;
  const showSpeaker = showBotSenderName || Boolean(authorName);
  const firstContent = segments.findIndex((segment) => segment.kind === "content");
  const choiceBlocks = message.blocks.filter(
    (block): block is Extract<MessageBlock, { kind: "choice" }> => block.kind === "choice",
  );
  const computerBlocks = message.blocks.filter(
    (block): block is Extract<MessageBlock, { kind: "computer" }> => block.kind === "computer",
  );
  return (
    <View style={{ gap: 8, width: "100%" }}>
      {segments.map((segment, index) => (
        <MessageTextCard
          key={`${message.id}-content-${index}`}
          message={{ ...message, blocks: segment.blocks }}
          outgoing={outgoing}
          speaker={showSpeaker && index === firstContent ? speaker : undefined}
          speakerColor={showSpeaker && index === firstContent ? speakerColor : undefined}
          actionProps={actionProps}
          doubleTapSurface={doubleTapSurface}
          userBubble={userBubble}
        />
      ))}
      {choiceBlocks.map((block, index) => (
        <ChoiceCard
          key={`choice-${index}`}
          threadId={artifactTarget.threadId}
          block={block}
          onDismissed={onChoiceDismissed ? () => onChoiceDismissed(block.question) : undefined}
          accessibilityActions={actionProps.accessibilityActions}
          onAccessibilityAction={actionProps.onAccessibilityAction}
        />
      ))}
      {computerBlocks.map((block, index) => (
        <ComputerCard
          key={`computer-${index}`}
          block={block}
          onOpen={onOpenComputer}
          accessibilityActions={actionProps.accessibilityActions}
          onAccessibilityAction={actionProps.onAccessibilityAction}
        />
      ))}
      {appConnectBlocks.map((block, index) => (
        <AppConnectCard
          key={`${block.provider}-${index}`}
          threadId={message.threadId}
          messageId={message.id}
          block={block}
          accessibilityActions={actionProps.accessibilityActions}
          onAccessibilityAction={actionProps.onAccessibilityAction}
        />
      ))}
    </View>
  );
});

function MessageTextCard({
  message,
  outgoing,
  speaker,
  speakerColor,
  actionProps,
  doubleTapSurface = false,
  userBubble,
}: {
  message: MobileMessage;
  outgoing: boolean;
  speaker?: string;
  speakerColor?: string;
  actionProps: MessageActionProps;
  doubleTapSurface?: boolean;
  userBubble?: UserBubble;
}) {
  const colorScheme = useResolvedAppearance();
  const tokens = withUserBubble(mobileTokens(), userBubble);
  const contentText = blockText(message);
  if (!contentText) return null;
  // The menu wrapper owns surface gestures; links and code controls remain responders.
  const Surface = doubleTapSurface ? View : Pressable;
  return (
    <Surface
      {...actionProps}
      accessible
      onLongPress={doubleTapSurface ? undefined : actionProps.onLongPress}
      style={{
        flexShrink: 1,
        minWidth: 0,
        maxWidth: "100%",
        backgroundColor: outgoing ? tokens.chatUser : tokens.muted,
        paddingHorizontal: 14,
        paddingVertical: 9,
        borderRadius: 20,
      }}
    >
      {speaker ? (
        <Text
          style={{
            color: speakerColor ?? tokens.mutedForeground,
            ...typeScale.footnote,
            marginBottom: 4,
          }}
        >
          {speaker}
        </Text>
      ) : null}
      <MessageCaption
        role={message.role}
        received={!outgoing}
        text={contentText}
        tokens={tokens}
        colorScheme={colorScheme}
        streaming={message.id.startsWith("progress:")}
      />
    </Surface>
  );
}
