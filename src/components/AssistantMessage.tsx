import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { chatMessageContentWidthClassName } from "../lib/chatStyles";
import {
  getCopyableAssistantMessageText,
  normalizeAssistantMessageContent,
} from "../lib/chatMessageContent";
import type {
  AssistantWaitingIndicatorVariant,
  ToolInvocationTrace,
} from "../types/chat";
import { MarkdownRenderer } from "./chat/MarkdownRenderer";
import { ThinkingBlock } from "./chat/ThinkingBlock";
import { ThinkingIndicator } from "./chat/ThinkingIndicator";
import { resolveAssistantWaitingIndicatorVariant } from "./chat/assistantWaitingIndicator";
import { ToolInvocationGroup } from "./chat/ToolInvocationGroup";
import {
  getToolInvocationDisplayEntries,
  type ToolInvocationDisplayEntry,
} from "./chat/toolInvocationPresentation";
import type { ToolDecisionSubmission } from "./chat/ToolDecisionRequestCard";

interface AssistantMessageProps {
  content: string;
  hasSubsequentAssistantText?: boolean;
  isConversationStreaming?: boolean;
  isStreaming?: boolean;
  isTextStreaming?: boolean;
  reasoningCompletedAt?: number;
  reasoningContent?: string;
  showCopyButton?: boolean;
  timestamp: number;
  toolInvocations?: ToolInvocationTrace[];
  onToolDecisionSubmit?: (
    invocation: ToolInvocationTrace,
    submission: ToolDecisionSubmission,
  ) => void;
  waitingIndicatorVariant?: AssistantWaitingIndicatorVariant;
  workspaceRootPath?: string | null;
}

interface RenderedToolBlock {
  entries: readonly ToolInvocationDisplayEntry[]
  key: string
  groupType: 'exploring'
}

function buildRenderedToolBlocks(entries: readonly ToolInvocationDisplayEntry[]) {
  const renderedBlocks: RenderedToolBlock[] = []
  let groupedEntries: ToolInvocationDisplayEntry[] = []
  let currentGroupType: RenderedToolBlock['groupType'] | null = null

  const flushGroupedEntries = () => {
    if (groupedEntries.length === 0 || currentGroupType === null) {
      return
    }

    renderedBlocks.push({
      entries: groupedEntries,
      key: groupedEntries.map((entry) => entry.key).join(':'),
      groupType: currentGroupType,
    })

    groupedEntries = []
    currentGroupType = null
  }

  for (const entry of entries) {
    const nextGroupType: RenderedToolBlock['groupType'] = 'exploring'
    if (currentGroupType !== null && currentGroupType !== nextGroupType) {
      flushGroupedEntries()
    }

    currentGroupType = nextGroupType
    groupedEntries.push(entry)
  }

  flushGroupedEntries()

  return renderedBlocks
}

export function AssistantMessage({
  content,
  hasSubsequentAssistantText = false,
  isConversationStreaming = false,
  isStreaming = false,
  isTextStreaming = false,
  reasoningCompletedAt,
  reasoningContent = "",
  showCopyButton = false,
  timestamp,
  toolInvocations = [],
  onToolDecisionSubmit,
  waitingIndicatorVariant = "thinking",
  workspaceRootPath = null,
}: AssistantMessageProps) {
  const [isCopied, setIsCopied] = useState(false);
  const normalizedContent = normalizeAssistantMessageContent({
    content,
    reasoningContent,
  });
  const hasContent = normalizedContent.content.trim().length > 0;
  const hasReasoningContent =
    normalizedContent.reasoningContent.trim().length > 0;
  const hasVisibleAssistantText =
    hasContent || hasReasoningContent || hasSubsequentAssistantText;
  const hasActiveReasoningBlock =
    hasReasoningContent && reasoningCompletedAt === undefined;
  const toolDisplayEntries = toolInvocations.flatMap((invocation) =>
    getToolInvocationDisplayEntries(invocation),
  );
  const renderedToolBlocks = buildRenderedToolBlocks(toolDisplayEntries);
  const hasVisibleToolBlocks = renderedToolBlocks.length > 0;
  const shouldShowWaitingIndicator =
    isStreaming &&
    !isTextStreaming &&
    !hasVisibleToolBlocks &&
    !hasActiveReasoningBlock;
  const effectiveWaitingIndicatorVariant = resolveAssistantWaitingIndicatorVariant({
    hasVisibleAssistantText,
    toolInvocations,
    waitingIndicatorVariant,
  });
  const copyableText = getCopyableAssistantMessageText({ content, reasoningContent });
  const canShowCopyButton =
    showCopyButton && !isStreaming && copyableText.length > 0;
  const messagePaddingClassName = canShowCopyButton ? "pb-5 pr-5" : "";

  useEffect(() => {
    if (!isCopied) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setIsCopied(false);
    }, 1400);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isCopied]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(copyableText);
      setIsCopied(true);
    } catch {
      setIsCopied(false);
    }
  }

  if (
    !hasContent &&
    !hasReasoningContent &&
    toolInvocations.length === 0 &&
    !shouldShowWaitingIndicator
  ) {
    return null;
  }

  return (
    <div
      className={[
        "group relative space-y-2",
        messagePaddingClassName,
        chatMessageContentWidthClassName,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {hasReasoningContent ? (
        <ThinkingBlock
          content={normalizedContent.reasoningContent}
          isComplete={!isStreaming}
          reasoningCompletedAt={reasoningCompletedAt}
          startTime={timestamp}
        />
      ) : null}

      {hasContent ? (
        <MarkdownRenderer
          content={normalizedContent.content}
          className="text-left text-[15px]"
          isStreaming={isStreaming}
        />
      ) : null}

      {renderedToolBlocks.map((block) => (
        <ToolInvocationGroup
          key={block.key}
          entries={block.entries}
          hasAssistantText={hasVisibleAssistantText}
          isConversationStreaming={isConversationStreaming}
          onToolDecisionSubmit={onToolDecisionSubmit}
          workspaceRootPath={workspaceRootPath}
        />
      ))}

      {shouldShowWaitingIndicator ? (
        <ThinkingIndicator variant={effectiveWaitingIndicatorVariant} />
      ) : null}

      {canShowCopyButton ? (
        <button
          type="button"
          onClick={handleCopy}
          className="absolute bottom-1.5 right-1.5 inline-flex h-5 w-5 items-center justify-center text-muted-foreground opacity-0 pointer-events-none transition-[color,opacity,transform] duration-150 hover:scale-105 hover:text-foreground group-hover:opacity-100 group-hover:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto"
          aria-label={isCopied ? "Copied message" : "Copy message"}
          title={isCopied ? "Copied" : "Copy"}
        >
          {isCopied ? (
            <Check className="h-4 w-4" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </button>
      ) : null}
    </div>
  );
}
