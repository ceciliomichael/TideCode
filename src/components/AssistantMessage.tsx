import { Check, Copy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { chatMessageContentWidthClassName } from "../lib/chatStyles";
import {
  getCopyableAssistantMessageText,
  normalizeAssistantMessageContent,
} from "../lib/chatMessageContent";
import type { Message, ToolInvocationTrace } from "../types/chat";
import { MarkdownRenderer } from "./chat/MarkdownRenderer";
import { AssistantWorkBlock } from "./chat/AssistantWorkBlock";
import type { ToolDecisionSubmission } from "./chat/ToolDecisionRequestCard";

interface AssistantMessageProps {
  isComplete: boolean;
  isConversationStreaming?: boolean;
  isStreaming?: boolean;
  isTextStreaming?: boolean;
  messages: readonly Message[];
  showCopyButton?: boolean;
  waitingIndicatorVariant?: "thinking" | "splash" | "rate_limit_retry";
  onToolDecisionSubmit?: (
    invocation: ToolInvocationTrace,
    submission: ToolDecisionSubmission,
  ) => void;
  workspaceRootPath?: string | null;
}

export function AssistantMessage({
  isComplete,
  isConversationStreaming = false,
  isStreaming = false,
  isTextStreaming = false,
  messages,
  showCopyButton = false,
  waitingIndicatorVariant = "thinking",
  onToolDecisionSubmit,
  workspaceRootPath = null,
}: AssistantMessageProps) {
  const [isCopied, setIsCopied] = useState(false);
  const lastMessage = messages[messages.length - 1];
  const normalizedMessages = useMemo(
    () => messages.map((message) => normalizeAssistantMessageContent(message)),
    [messages],
  );
  const finalNormalizedContent = normalizedMessages[normalizedMessages.length - 1]?.content ?? "";
  const hasFinalContent = finalNormalizedContent.trim().length > 0;
  const shouldShowFinalContentOutside = isComplete && hasFinalContent;
  const finalCopyableText = lastMessage
    ? getCopyableAssistantMessageText(lastMessage)
    : "";

  const canShowCopyButton =
    showCopyButton && !isStreaming && finalCopyableText.length > 0;
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
      await navigator.clipboard.writeText(finalCopyableText);
      setIsCopied(true);
    } catch {
      setIsCopied(false);
    }
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
      <AssistantWorkBlock
        showFinalContentOutside={shouldShowFinalContentOutside}
        isComplete={isComplete}
        isConversationStreaming={isConversationStreaming}
        isStreaming={isStreaming}
        isTextStreaming={isTextStreaming}
        messages={messages}
        startTime={messages[0]?.timestamp ?? Date.now()}
        waitingIndicatorVariant={waitingIndicatorVariant}
        onToolDecisionSubmit={onToolDecisionSubmit}
        workspaceRootPath={workspaceRootPath}
      />

      {shouldShowFinalContentOutside ? (
        <MarkdownRenderer
          content={finalNormalizedContent}
          className="text-left text-[15px]"
          isStreaming={isTextStreaming}
        />
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
