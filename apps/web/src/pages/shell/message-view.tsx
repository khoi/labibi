import { ChatMarkdown, LinkifiedText } from "@labradoodle/chat-ui/web";
import type { LoginFieldInput, MessageReaction, ThreadMessage } from "@labradoodle/contracts";
import { isToolActivityBlock, otherAuthor } from "@labradoodle/core";
import { BotAvatar, Button, cn, resolvePersonaColorDef } from "@labradoodle/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { memo, useMemo } from "react";
import { ArtifactFileCard } from "../../components/ArtifactFileCard";
import { AskCard } from "../../components/AskCard";
import { CloudAgentCard } from "../../components/CloudAgentCard";
import { McpAppCard } from "../../components/McpAppCard";
import { PageBlockCard } from "../../components/pages/PageBlockCard";
import { SubagentCard } from "../../components/SubagentCard";
import {
  LIVE_TOOL_STEP_WINDOW,
  StandaloneToolActivity,
  ToolActivityDisclosure,
  ToolOnlyNarration,
  ToolSteps,
} from "../../components/ToolActivityDisclosure";
import { SkillDraftCard } from "../../components/teach/SkillDraftCard";
import type { ArtifactTarget } from "../../lib/artifact-open";
import type { PageBlock } from "../../lib/page-cards";
import { useOpenPage } from "../../lib/pages";
import type { createSpaceRpc } from "../../lib/rpc";
import {
  isToolOnlyNarration,
  renderableMessageBlocks,
  shouldRenderToolCard,
  toolStepCount,
} from "../../lib/tool-activity-view";
import { ReplyLine } from "./chat-context";
import { FALLBACK_BOT_COLOR, previewMessageText } from "./chat-shared";
import {
  AppConnectCard,
  ArtifactImage,
  ChartBlockView,
  ChoiceCard,
  McpApprovalCard,
} from "./message-cards";
import { MessageHoverActions } from "./message-hover-actions";

export const MessageView = memo(function MessageView({
  artifactTarget,
  canAnswer,
  canDismiss,
  message,
  meId,
  pages,
  isPageSuperseded,
  onAnswer,
  speakerName,
  memberName,
  peerBot,
  replyParent,
  onJumpToMessage,
  onRefresh,
  onBotChanged,
  onAddRoutine,
  voiceReady,
  speaking,
  onSpeak,
  onOpenComputer,
  rpc,
  showToolActivity,
  onReply,
  onMarkUnread,
  markedUnread = false,
  onReact,
}: {
  artifactTarget: ArtifactTarget;
  canAnswer: boolean;
  canDismiss: boolean;
  message: ThreadMessage;
  /** The signed-in person; anyone else's message is named and set apart. */
  meId?: string;
  /** Pages saved just before this reply, drawn under its text. */
  pages?: readonly PageBlock[];
  /** Whether a later card in the chat shows the same page. */
  isPageSuperseded?: (messageId: string, block: PageBlock) => boolean;
  onAnswer: (
    message: ThreadMessage,
    text: string,
    fields?: LoginFieldInput[],
    dismiss?: boolean,
    remember?: false,
  ) => Promise<void>;
  speakerName?: string;
  memberName?: (botId: string | undefined) => string | undefined;
  peerBot: (botId: string) => { name?: string; color: string; status?: string } | undefined;
  replyParent?: ThreadMessage;
  onJumpToMessage?: (messageId: string) => void;
  onRefresh: () => Promise<void>;
  onBotChanged: () => Promise<void>;
  onAddRoutine: (name: string, prompt: string) => void;
  voiceReady: boolean;
  speaking: boolean;
  onSpeak: (message: ThreadMessage) => void;
  onOpenComputer: (botId?: string) => void;
  /** Opens where an imported item's setup is finished. */
  rpc: ReturnType<typeof createSpaceRpc>;
  showToolActivity: boolean;
  onReply: (message: ThreadMessage) => void;
  onMarkUnread: (message: ThreadMessage) => void;
  markedUnread?: boolean;
  onReact: (message: ThreadMessage, reaction: MessageReaction) => Promise<void>;
}) {
  const { t } = useLingui();
  const isNarration =
    message.role === "bot" &&
    message.blocks.length > 0 &&
    message.blocks.every(
      (block) => block.kind === "text" || block.kind === "progress" || block.kind === "steps",
    );
  const isLive = message.id.startsWith("progress:");
  const quoteMessageId = message.id.includes(":") ? undefined : message.id;

  const blocks = message.blocks;
  const openPage = useOpenPage();
  const pageCards = pages?.length ? (
    <div className="mt-3 flex flex-col gap-3">
      {pages.map((page) => (
        <PageBlockCard
          key={`${page.pageId}:${page.version}`}
          block={page}
          updated={isPageSuperseded?.(message.id, page) ?? false}
        />
      ))}
    </div>
  ) : null;
  const visibleNarrationBlocks = renderableMessageBlocks(blocks, showToolActivity);
  const speak = () => onSpeak(message);
  const replyBotId = message.replyPreview?.botId ?? replyParent?.botId;
  const author = message.role === "user" ? otherAuthor(message.author, meId) : undefined;
  const replyAuthor = otherAuthor(message.replyPreview?.author ?? replyParent?.author, meId);
  const speakerBot = message.botId ? peerBot?.(message.botId) : undefined;
  const speakerColorDef = useMemo(
    () => resolvePersonaColorDef(message.botId ?? "bot", speakerBot?.color),
    [message.botId, speakerBot?.color],
  );
  const messageContext = (
    <>
      {speakerName ? (
        <div
          className="mb-1.5 flex items-center gap-2 text-[13px] font-semibold tracking-tight"
          dir="auto"
          style={{ color: speakerColorDef.hex }}
        >
          <BotAvatar
            color={speakerBot?.color ?? FALLBACK_BOT_COLOR}
            identity={message.botId}
            size={22}
          />
          {speakerName}
        </div>
      ) : author ? (
        <div
          className="mb-1.5 text-end text-[13px] font-semibold tracking-tight text-muted-foreground"
          dir="auto"
        >
          {author.name}
        </div>
      ) : null}
      <ReplyLine
        target={artifactTarget}
        message={message}
        fallbackText={replyParent ? previewMessageText(replyParent) : undefined}
        author={
          (message.replyPreview?.role ?? replyParent?.role) === "user"
            ? (replyAuthor?.name ?? t`You`)
            : ((replyBotId ? peerBot(replyBotId)?.name : undefined) ??
              memberName?.(replyBotId) ??
              t`Bot`)
        }
        onJump={onJumpToMessage}
      />
    </>
  );
  // Anchored below the speaker and reply line so the rail centers on the bubble itself.
  // A message with text and attachments anchors it on its first text bubble.
  const textAnchorIndex = message.blocks.findIndex((block) => block.kind === "text");
  const hoverAnchorIndex =
    textAnchorIndex === -1
      ? message.blocks.findIndex((block) => block.kind === "ask")
      : textAnchorIndex;
  const hoverActions = (
    <MessageHoverActions
      message={message}
      side={message.role === "user" ? "start" : "end"}
      onReply={onReply}
      onMarkUnread={onMarkUnread}
      markedUnread={markedUnread}
      onReact={onReact}
    />
  );
  if (isNarration) {
    if (visibleNarrationBlocks.length === 0) return null;
    if (isToolOnlyNarration(message.blocks, showToolActivity)) {
      return (
        <>
          {messageContext}
          <div className="relative">
            <ToolOnlyNarration blocks={visibleNarrationBlocks} live={isLive} />
            {hoverActions}
          </div>
        </>
      );
    }
    return (
      <>
        {messageContext}
        <div className="relative w-fit max-w-full [@media(hover:none)]:w-full">
          <div className="flex w-fit max-w-full justify-start [@media(hover:none)]:w-full">
            <div
              data-testid="message-bot-bubble"
              className="max-w-full space-y-2.5 rounded-[20px] bg-muted px-[18px] py-3 text-body1 text-foreground"
              dir="auto"
            >
              {visibleNarrationBlocks.map((block, i) => {
                if (block.kind === "steps") {
                  return (
                    <ToolActivityDisclosure
                      key={i}
                      live={isLive}
                      stepCount={toolStepCount(block.steps)}
                      durationMs={block.durationMs}
                    >
                      <ToolSteps
                        steps={block.steps}
                        currentIndex={isLive ? block.steps.length - 1 : undefined}
                        limit={isLive ? LIVE_TOOL_STEP_WINDOW : undefined}
                      />
                    </ToolActivityDisclosure>
                  );
                }
                if (block.kind === "text" || block.kind === "progress") {
                  return (
                    <div
                      key={i}
                      data-quote-message-id={block.kind === "text" ? quoteMessageId : undefined}
                    >
                      <ChatMarkdown streaming={block.kind === "progress"} onOpenPage={openPage}>
                        {block.text}
                      </ChatMarkdown>
                    </div>
                  );
                }
                return null;
              })}
              {!isLive && voiceReady && message.blocks.some((block) => block.kind === "text") ? (
                <Button
                  variant="text"
                  size="xs"
                  aria-label={speaking ? t`Stop speaking` : t`Speak this reply`}
                  onClick={speak}
                  className="font-normal"
                >
                  {speaking ? <Trans>Stop</Trans> : <Trans>Speak</Trans>}
                </Button>
              ) : null}
            </div>
          </div>
          {hoverActions}
        </div>
        {pageCards}
      </>
    );
  }
  return (
    <>
      {messageContext}
      <div className={cn("relative flex flex-col gap-2", message.role === "user" && "items-end")}>
        {blocks.map((block, i) => {
          if (block.kind === "steps" && shouldRenderToolCard(block, showToolActivity)) {
            return (
              <StandaloneToolActivity
                key={i}
                live={isLive}
                steps={block.steps}
                stepCount={toolStepCount(block.steps)}
                durationMs={block.durationMs}
              />
            );
          }
          if (isToolActivityBlock(block)) return null;
          if (block.kind === "meta") {
            return (
              <div
                key={i}
                className="flex items-center justify-center gap-2 py-1 text-[13.5px] text-muted-foreground"
              >
                <span className="text-warning">◷</span>
                <span>{block.text}</span>
              </div>
            );
          }
          if (block.kind === "progress") {
            return (
              <div
                key={i}
                className="flex w-fit max-w-full justify-start [@media(hover:none)]:w-full"
              >
                <div
                  data-testid="message-bot-bubble"
                  className="max-w-full rounded-[20px] bg-muted px-[18px] py-3 text-body1 text-foreground"
                  dir="auto"
                >
                  <ChatMarkdown streaming onOpenPage={openPage}>
                    {block.text}
                  </ChatMarkdown>
                </div>
              </div>
            );
          }
          if (block.kind === "subagent") {
            return <SubagentCard key={i} block={block} />;
          }
          if (block.kind === "choice") {
            const botId = "botId" in artifactTarget ? artifactTarget.botId : message.botId;
            if (!botId) return null;
            return <ChoiceCard key={i} botId={botId} block={block} onBotChanged={onBotChanged} />;
          }
          if (block.kind === "app_connect") {
            const botId = "botId" in artifactTarget ? artifactTarget.botId : message.botId;
            if (!botId) return null;
            return (
              <div key={i} className="flex justify-start">
                <AppConnectCard
                  botId={botId}
                  threadId={message.threadId}
                  messageId={message.id}
                  block={block}
                />
              </div>
            );
          }
          if (block.kind === "page") {
            return (
              <PageBlockCard
                key={i}
                block={block}
                updated={isPageSuperseded?.(message.id, block) ?? false}
              />
            );
          }
          if (block.kind === "chart") {
            return (
              <div key={i} className="flex justify-start">
                <ChartBlockView name={block.name} spec={block.spec} data={block.data} />
              </div>
            );
          }
          if (block.kind === "app") {
            return (
              <div key={i} className="flex justify-start">
                <McpAppCard block={block} target={artifactTarget} />
              </div>
            );
          }
          if (block.kind === "mcp_approval") {
            const botId = "botId" in artifactTarget ? artifactTarget.botId : message.botId;
            if (!botId) return null;
            return (
              <div key={i} className="flex justify-start">
                <McpApprovalCard botId={botId} threadId={message.threadId} block={block} />
              </div>
            );
          }
          if (block.kind === "image") {
            return (
              <div
                key={i}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <ArtifactImage
                  target={artifactTarget}
                  artifactId={block.artifactId}
                  name={block.name}
                />
              </div>
            );
          }
          if (block.kind === "file") {
            return (
              <div
                key={i}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <ArtifactFileCard
                  target={artifactTarget}
                  artifactId={block.artifactId}
                  name={block.name}
                  mimeType={block.mimeType}
                  size={block.size}
                />
              </div>
            );
          }
          if (block.kind === "text" && message.role === "user") {
            // User bubbles stay literal text on web and mobile. Only explicit URLs,
            // email addresses and page links are links, so a sent address is tappable
            // without formatting bold or headings.
            return (
              <div
                key={i}
                className="relative flex w-fit max-w-full justify-end [@media(hover:none)]:w-full [@media(hover:none)]:flex-wrap"
              >
                <div
                  data-testid="message-user-bubble"
                  data-quote-message-id={quoteMessageId}
                  className={cn(
                    "max-w-full whitespace-pre-wrap wrap-anywhere rounded-[20px] px-[18px] py-3 text-body1",
                    author
                      ? "bg-muted text-foreground/90"
                      : "bg-chat-user text-chat-user-foreground",
                  )}
                  dir="auto"
                >
                  <LinkifiedText onOpenPage={openPage}>{block.text}</LinkifiedText>
                </div>
                {i === hoverAnchorIndex ? hoverActions : null}
              </div>
            );
          }
          if (block.kind === "text") {
            return (
              <div
                key={i}
                className="relative flex w-fit max-w-full justify-start [@media(hover:none)]:w-full [@media(hover:none)]:flex-wrap"
              >
                <div
                  data-testid="message-bot-bubble"
                  className="max-w-full rounded-[20px] bg-muted px-[18px] py-3 text-body1 text-foreground"
                  dir="auto"
                >
                  <div data-quote-message-id={quoteMessageId}>
                    <ChatMarkdown onOpenPage={openPage}>{block.text}</ChatMarkdown>
                  </div>
                  {voiceReady ? (
                    <Button
                      variant="text"
                      size="xs"
                      aria-label={speaking ? t`Stop speaking` : t`Speak this reply`}
                      onClick={speak}
                      className="mt-2 font-normal"
                    >
                      {speaking ? <Trans>Stop</Trans> : <Trans>Speak</Trans>}
                    </Button>
                  ) : null}
                </div>
                {i === hoverAnchorIndex ? hoverActions : null}
              </div>
            );
          }
          if (block.kind === "card") {
            return (
              <div key={i} className="flex justify-start">
                <div className="flex flex-col gap-2 rounded-[20px] bg-muted px-5 py-4">
                  {block.lines.map((line) => (
                    <div key={line.k} className="flex items-baseline gap-2.5 text-[15px]">
                      <span className="text-success">✓</span>
                      <span className="font-semibold text-foreground">{line.k}</span>
                      <span className="text-muted-foreground">→</span>
                      <span>{line.v}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          }
          if (block.kind === "ask") {
            return (
              <div key={i} className="relative w-full min-w-0">
                <AskCard
                  block={block}
                  canAnswer={canAnswer}
                  canDismiss={canDismiss}
                  onAnswer={(text, fields, remember) =>
                    onAnswer(message, text, fields, undefined, remember)
                  }
                  onDismiss={() => onAnswer(message, "", undefined, true)}
                  rpc={rpc}
                />
                {i === hoverAnchorIndex ? hoverActions : null}
              </div>
            );
          }
          if (block.kind === "cloud_agent") return <CloudAgentCard key={i} block={block} />;
          if (block.kind === "skill_draft") {
            return (
              <div key={i} className="flex justify-start">
                <SkillDraftCard block={block} onRefresh={onRefresh} onAddRoutine={onAddRoutine} />
              </div>
            );
          }
          if (block.kind === "computer") {
            return (
              <div
                key={i}
                data-testid="computer-card"
                className="w-[340px] max-w-full rounded-[18px] border border-border bg-muted px-[18px] py-4"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[15px] font-medium text-foreground">
                    <Trans>Computer</Trans>
                  </span>
                  <span
                    className={
                      block.state === "Needs you"
                        ? "rounded-full bg-warning/15 px-[11px] py-1 text-[13px] text-warning"
                        : block.state === "Skipped"
                          ? "rounded-full bg-foreground/10 px-[11px] py-1 text-[13px] text-muted-foreground"
                          : "rounded-full bg-success/15 px-[11px] py-1 text-[13px] text-success"
                    }
                  >
                    {block.state === "Needs you"
                      ? t`Needs you`
                      : block.state === "Skipped"
                        ? t`Skipped`
                        : block.state === "Done"
                          ? t`Done`
                          : block.state}
                  </span>
                </div>
                <div className="my-2.5 text-[14.5px] leading-[1.5] text-foreground/75">
                  <ChatMarkdown>{block.text}</ChatMarkdown>
                </div>
                <Button
                  type="button"
                  size="sm"
                  data-testid="computer-card-open"
                  onClick={() => onOpenComputer(message.botId)}
                >
                  <Trans>Open</Trans>
                </Button>
              </div>
            );
          }
          return null;
        })}
        {hoverAnchorIndex === -1 ? hoverActions : null}
      </div>
      {pageCards}
    </>
  );
});
