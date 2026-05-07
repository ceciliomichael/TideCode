import { ChevronRight } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import { formatChatDuration } from "../chatDuration";
import { normalizeAssistantMessageContent } from "../../lib/chatMessageContent";
import type {
  AssistantWaitingIndicatorVariant,
  Message,
  ToolInvocationTrace,
} from "../../types/chat";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { ThinkingBlock } from "./ThinkingBlock";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { resolveAssistantWaitingIndicatorVariant } from "./assistantWaitingIndicator";
import { ToolInvocationGroup } from "./ToolInvocationGroup";
import {
  getToolInvocationDisplayEntries,
  type ToolInvocationDisplayEntry,
} from "./toolInvocationPresentation";
import type { ToolDecisionSubmission } from "./ToolDecisionRequestCard";

interface AssistantWorkBlockProps {
  isComplete: boolean;
  isConversationStreaming: boolean;
  isStreaming: boolean;
  isTextStreaming: boolean;
  showFinalContentOutside: boolean;
  messages: readonly Message[];
  startTime: number;
  waitingIndicatorVariant?: AssistantWaitingIndicatorVariant;
  onToolDecisionSubmit?: (
    invocation: ToolInvocationTrace,
    submission: ToolDecisionSubmission,
  ) => void;
  workspaceRootPath?: string | null;
}

interface AssistantWorkMessageEntry {
  content: string;
  hasVisibleContent: boolean;
  isFinalMessage: boolean;
  key: string;
  message: Message;
  normalizedContent: ReturnType<typeof normalizeAssistantMessageContent>;
  toolDisplayEntries: readonly ToolInvocationDisplayEntry[];
  toolInvocations: readonly ToolInvocationTrace[];
}

function buildAssistantWorkMessageEntries(
  messages: readonly Message[],
  showFinalContentOutside: boolean,
): AssistantWorkMessageEntry[] {
  const entries: AssistantWorkMessageEntry[] = []
  const lastMessageIndex = messages.length - 1

  for (const [index, message] of messages.entries()) {
    const normalizedContent = normalizeAssistantMessageContent(message)
    const isFinalMessage = index === lastMessageIndex
    const shouldRenderContent =
      !isFinalMessage ||
      !showFinalContentOutside ||
      normalizedContent.content.trim().length === 0
    const toolInvocations = message.toolInvocations ?? []
    const toolDisplayEntries = toolInvocations.flatMap((invocation) =>
      getToolInvocationDisplayEntries(invocation),
    )

    entries.push({
      content: shouldRenderContent ? normalizedContent.content : "",
      hasVisibleContent:
        normalizedContent.reasoningContent.trim().length > 0 ||
        shouldRenderContent && normalizedContent.content.trim().length > 0 ||
        toolDisplayEntries.length > 0,
      isFinalMessage,
      key: message.id,
      message,
      normalizedContent,
      toolDisplayEntries,
      toolInvocations,
    })
  }

  return entries
}

export const AssistantWorkBlock = memo(function AssistantWorkBlock({
  isComplete,
  isConversationStreaming,
  isStreaming,
  isTextStreaming,
  showFinalContentOutside,
  messages,
  startTime,
  waitingIndicatorVariant = "thinking",
  onToolDecisionSubmit,
  workspaceRootPath = null,
}: AssistantWorkBlockProps) {
  const [isOpen, setIsOpen] = useState(!isComplete)
  const [elapsedSeconds, setElapsedSeconds] = useState<number | null>(null)
  const [completedDuration, setCompletedDuration] = useState<number | null>(null)
  const normalizedMessages = useMemo(
    () => buildAssistantWorkMessageEntries(messages, showFinalContentOutside),
    [messages, showFinalContentOutside],
  )
  const hasVisibleAssistantText = normalizedMessages.some((entry) => entry.hasVisibleContent)
  const hasVisibleToolBlocks = normalizedMessages.some((entry) => entry.toolDisplayEntries.length > 0)
  const shouldShowWaitingIndicator =
    isStreaming &&
    !isTextStreaming &&
    !hasVisibleAssistantText &&
    !hasVisibleToolBlocks
  const effectiveWaitingIndicatorVariant = resolveAssistantWaitingIndicatorVariant({
    hasVisibleAssistantText,
    toolInvocations: normalizedMessages.flatMap((entry) => entry.toolInvocations),
    waitingIndicatorVariant,
  })
  const stableDuration = completedDuration ?? elapsedSeconds ?? 0
  const headerLabel = isComplete
    ? `Worked for ${formatChatDuration(stableDuration)}`
    : `Working for ${formatChatDuration(stableDuration)}`

  useEffect(() => {
    if (isComplete) {
      setIsOpen(false)
      setCompletedDuration((currentValue) =>
        currentValue ?? Math.max((Date.now() - startTime) / 1000, 0),
      )
      setElapsedSeconds(null)
      return
    }

    setCompletedDuration(null)
    setIsOpen(true)
    const updateElapsedSeconds = () => {
      setElapsedSeconds((Date.now() - startTime) / 1000)
    }

    updateElapsedSeconds()
    const intervalId = window.setInterval(updateElapsedSeconds, 100)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [isComplete, startTime])

  const handleToggle = () => {
    setIsOpen((currentValue) => !currentValue)
  }

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={handleToggle}
        className="group flex w-full min-w-0 items-center text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <span className="flex min-w-0 flex-1 items-center gap-1">
          <span
            className={[
              isComplete ? "text-muted-foreground" : "thinking-shimmer",
            ].join(" ")}
          >
            {headerLabel}
          </span>
          <ChevronRight
            className={[
              "h-3.5 w-3.5 shrink-0 opacity-0 transition-[opacity,transform] duration-200 group-hover:opacity-100",
              isOpen ? "rotate-90" : "",
            ].join(" ")}
          />
        </span>
      </button>

      {isOpen && (hasVisibleAssistantText || hasVisibleToolBlocks || shouldShowWaitingIndicator) ? (
        <div className="mt-1.5 space-y-2 text-sm text-foreground">
          {normalizedMessages.map((entry) => (
            <div key={entry.key} className="space-y-1.5">
              {entry.normalizedContent.reasoningContent.trim().length > 0 ? (
                <ThinkingBlock
                  content={entry.normalizedContent.reasoningContent}
                  isComplete={isComplete || !entry.isFinalMessage}
                  startTime={entry.message.timestamp}
                  reasoningCompletedAt={entry.message.reasoningCompletedAt}
                />
              ) : null}

              {entry.toolDisplayEntries.length > 0 ? (
                <ToolInvocationGroup
                  entries={entry.toolDisplayEntries}
                  hasAssistantText={hasVisibleAssistantText}
                  isConversationStreaming={isConversationStreaming}
                  onToolDecisionSubmit={onToolDecisionSubmit}
                  workspaceRootPath={workspaceRootPath}
                />
              ) : null}

              {entry.content.trim().length > 0 ? (
                <MarkdownRenderer
                  content={entry.content}
                  className="text-left text-[15px]"
                  isStreaming={isStreaming && !isTextStreaming}
                />
              ) : null}
            </div>
          ))}

          {shouldShowWaitingIndicator ? (
            <ThinkingIndicator variant={effectiveWaitingIndicatorVariant} />
          ) : null}
        </div>
      ) : null}
    </div>
  )
})
