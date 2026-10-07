import { Check, Copy, GitBranch, MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { chatMessageContentWidthClassName } from "../lib/chatStyles";
import { copyTextToClipboard } from "../lib/clipboard";
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
import { ToolInvocationBlock } from "./chat/ToolInvocationBlock";
import { ToolInvocationGroup } from "./chat/ToolInvocationGroup";
import { AnchoredTooltip, Tooltip } from "./Tooltip";
import {
  getToolInvocationDisplayEntries,
  type ToolInvocationDisplayEntry,
} from "./chat/toolInvocationPresentation";
import type { ToolDecisionSubmission } from "./chat/ToolDecisionRequestCard";

interface AssistantMessageProps {
  content: string;
  finalizeToolGroups?: boolean;
  hasSubsequentAssistantText?: boolean;
  isCompactionInProgress?: boolean;
  isConversationStreaming?: boolean;
  isStreaming?: boolean;
  isTextStreaming?: boolean;
  onBranch?: () => void;
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

function formatAssistantActionTimestamp(timestamp: number) {
  const date = new Date(timestamp)
  const now = new Date()
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

  if (isToday) {
    return `Today, ${time}`
  }

  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`
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
  finalizeToolGroups = false,
  hasSubsequentAssistantText = false,
  isCompactionInProgress = false,
  isConversationStreaming = false,
  isStreaming = false,
  isTextStreaming = false,
  onBranch,
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
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const actionsButtonRef = useRef<HTMLButtonElement | null>(null);
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
    !isCompactionInProgress &&
    !isTextStreaming &&
    !hasActiveReasoningBlock;
  const effectiveWaitingIndicatorVariant = resolveAssistantWaitingIndicatorVariant({
    hasVisibleAssistantText,
    toolInvocations,
    waitingIndicatorVariant,
  });
  const copyableText = getCopyableAssistantMessageText({ content, reasoningContent });
  const canShowCopyButton =
    showCopyButton && copyableText.length > 0;
  const isActionRowVisible = showCopyButton && !isStreaming && (canShowCopyButton || onBranch !== undefined);
  const messagePaddingClassName = isActionRowVisible ? "pb-6" : "";

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

  useEffect(() => {
    if (!isActionsOpen) return

    function handlePointerDown(event: PointerEvent) {
      const target = event.target
      if (!(target instanceof Node)) return
      if (actionsButtonRef.current?.contains(target)) return
      if (target instanceof Element && target.closest('[data-assistant-message-actions-menu="true"]')) return
      setIsActionsOpen(false)
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsActionsOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isActionsOpen]);

  async function handleCopy() {
    setIsCopied(await copyTextToClipboard(copyableText));
  }

  if (
    !hasContent &&
    !hasReasoningContent &&
    !hasVisibleToolBlocks &&
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
          preserveLineBreaks
        />
      ) : null}

      {renderedToolBlocks.map((block) => {
        const singleEntry = block.entries.length === 1 &&
          !finalizeToolGroups &&
          block.entries[0]?.invocation.toolName !== 'web_search'
          ? block.entries[0]
          : null;
        return singleEntry ? (
          <ToolInvocationBlock
            key={block.key}
            invocation={singleEntry.invocation}
            onToolDecisionSubmit={onToolDecisionSubmit}
            workspaceRootPath={workspaceRootPath}
          />
        ) : (
          <ToolInvocationGroup
            key={block.key}
            entries={block.entries}
            hasAssistantText={hasVisibleAssistantText}
            isFinalized={finalizeToolGroups}
            isConversationStreaming={isConversationStreaming}
            onToolDecisionSubmit={onToolDecisionSubmit}
            workspaceRootPath={workspaceRootPath}
          />
        );
      })}

      {shouldShowWaitingIndicator ? (
        <ThinkingIndicator variant={effectiveWaitingIndicatorVariant} />
      ) : null}

      {isActionRowVisible ? (
        <div className="absolute bottom-1.5 right-0 flex items-center gap-1 pointer-events-auto opacity-100 transition-opacity duration-150 md:pointer-events-none md:opacity-0 md:group-hover:opacity-100 md:group-hover:pointer-events-auto md:focus-within:opacity-100 md:focus-within:pointer-events-auto">
          {canShowCopyButton ? (
            <Tooltip content={isCopied ? "Copied" : "Copy"}>
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-[background-color,color,transform] hover:scale-105 hover:bg-surface-muted hover:text-foreground"
                aria-label={isCopied ? "Copied message" : "Copy message"}
              >
                {isCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </button>
            </Tooltip>
          ) : null}

          {onBranch ? (
            <>
              <button
                ref={actionsButtonRef}
                type="button"
                aria-label="Message actions"
                aria-haspopup="menu"
                aria-expanded={isActionsOpen}
                onClick={() => setIsActionsOpen((currentValue) => !currentValue)}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-[background-color,color,transform] hover:scale-105 hover:bg-surface-muted hover:text-foreground"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
              <AnchoredTooltip
                anchorElement={actionsButtonRef.current}
                content={
                  <div data-assistant-message-actions-menu="true" className="w-[210px] py-0.5">
                    <div className="px-2.5 py-1.5 text-[12px] font-normal text-muted-foreground">
                      {formatAssistantActionTimestamp(timestamp)}
                    </div>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setIsActionsOpen(false)
                        onBranch()
                      }}
                      className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm font-normal text-foreground transition-colors hover:bg-[var(--dropdown-option-hover-surface)]"
                    >
                      <GitBranch className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span>Branch in new chat</span>
                    </button>
                  </div>
                }
                panelClassName="!pointer-events-auto !block !p-1"
                side="top"
                visible={isActionsOpen}
              />
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
