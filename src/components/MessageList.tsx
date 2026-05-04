import { memo, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { isVisibleTranscriptMessage } from "../lib/chatMessageMetadata";
import { normalizeAssistantMessageContent } from "../lib/chatMessageContent";
import type {
  AssistantWaitingIndicatorVariant,
  ChatAttachment,
  ChatMode,
  Message,
  ReasoningEffort,
  ToolInvocationTrace,
} from "../types/chat";
import { AssistantMessage } from "./AssistantMessage";
import { ChatInput } from "./ChatInput";
import { UserMessage } from "./UserMessage";
import type { ChatModeOption } from "./chat/ChatModeSelectorField";
import type { ModelSelectorOption } from "./chat/ModelSelectorField";
import type { ToolDecisionSubmission } from "./chat/ToolDecisionRequestCard";

interface MessageListProps {
  chatModeOptions?: readonly ChatModeOption[];
  chatModeSelectorDisabled?: boolean;
  conversationId: string | null;
  composerAttachments: ChatAttachment[];
  composerValue: string;
  composerFocusSignal?: number;
  editComposerDirty?: boolean;
  editComposerMentionPathMap?: ReadonlyMap<string, string>;
  editingMessageId?: string | null;
  isSending?: boolean;
  messages: Message[];
  onAbortStreamingResponse?: () => void;
  onCancelEditingMessage: () => void;
  onChatModeChange?: (mode: ChatMode) => void;
  onToolDecisionSubmit?: (
    invocation: ToolInvocationTrace,
    submission: ToolDecisionSubmission,
  ) => void;
  onComposerAttachmentsChange: (attachments: ChatAttachment[]) => void;
  onComposerValueChange: (value: string) => void;
  onEditUserMessage?: (messageId: string) => void;
  onRevertUserMessage?: (messageId: string) => void;
  onModelChange?: (modelId: string) => void;
  onReasoningEffortChange?: (effort: ReasoningEffort) => void;
  onSendEditedMessage: (value: string, attachments: ChatAttachment[]) => void;
  selectedChatMode?: ChatMode;
  modelOptions?: readonly ModelSelectorOption[];
  modelOptionsLoading?: boolean;
  reasoningEffort?: ReasoningEffort;
  reasoningEffortOptions?: readonly ReasoningEffort[];
  selectedModelId?: string;
  sendMessageOnEnter: boolean;
  showReasoningEffortSelector?: boolean;
  streamingAssistantMessageId?: string | null;
  streamingWaitingIndicatorVariant?: AssistantWaitingIndicatorVariant | null;
  streamingTextActive?: boolean;
  workspaceRootPath?: string | null;
}

interface MessageRowProps {
  chatModeOptions?: readonly ChatModeOption[];
  chatModeSelectorDisabled?: boolean;
  composerAttachments: ChatAttachment[];
  composerFocusSignal?: number;
  composerValue: string;
  editComposerDirty: boolean;
  editComposerMentionPathMap?: ReadonlyMap<string, string>;
  isEditing: boolean;
  hasSubsequentAssistantText: boolean;
  isConversationStreaming: boolean;
  isSending: boolean;
  isStreaming: boolean;
  message: Message;
  showCopyButton: boolean;
  onAbortStreamingResponse?: () => void;
  onCancelEditingMessage: () => void;
  onChatModeChange?: (mode: ChatMode) => void;
  onToolDecisionSubmit?: (
    invocation: ToolInvocationTrace,
    submission: ToolDecisionSubmission,
  ) => void;
  onComposerAttachmentsChange: (attachments: ChatAttachment[]) => void;
  onComposerValueChange: (value: string) => void;
  onEditUserMessage?: (messageId: string) => void;
  onRevertUserMessage?: (messageId: string) => void;
  onModelChange?: (modelId: string) => void;
  onReasoningEffortChange?: (effort: ReasoningEffort) => void;
  onSendEditedMessage: (value: string, attachments: ChatAttachment[]) => void;
  selectedChatMode?: ChatMode;
  modelOptions?: readonly ModelSelectorOption[];
  modelOptionsLoading?: boolean;
  reasoningEffort?: ReasoningEffort;
  reasoningEffortOptions?: readonly ReasoningEffort[];
  selectedModelId?: string;
  sendMessageOnEnter: boolean;
  showReasoningEffortSelector?: boolean;
  waitingIndicatorVariant?: AssistantWaitingIndicatorVariant;
  isTextStreaming?: boolean;
  workspaceRootPath?: string | null;
  editClickBoundaryRef?: RefObject<HTMLElement>;
}

const MessageRow = memo(
  function MessageRow({
    chatModeOptions,
    chatModeSelectorDisabled,
    composerAttachments,
    composerFocusSignal,
    composerValue,
    editComposerDirty,
    editComposerMentionPathMap,
    hasSubsequentAssistantText,
    isConversationStreaming,
    isEditing,
    isSending: _isSending,
    isStreaming,
    message,
    showCopyButton,
    onAbortStreamingResponse,
    onCancelEditingMessage,
    onChatModeChange,
    onToolDecisionSubmit,
    onComposerAttachmentsChange,
    onComposerValueChange,
    onEditUserMessage,
    onRevertUserMessage,
    onModelChange,
    modelOptionsLoading,
    onReasoningEffortChange,
    onSendEditedMessage,
    selectedChatMode,
    modelOptions,
    reasoningEffort,
    reasoningEffortOptions,
    selectedModelId,
    sendMessageOnEnter,
    showReasoningEffortSelector,
    waitingIndicatorVariant,
    isTextStreaming = false,
    workspaceRootPath = null,
    editClickBoundaryRef,
  }: MessageRowProps) {
    return (
      <div
        data-message-id={message.id}
        className={
          message.role === "user"
            ? "flex w-full min-w-0 justify-start"
            : "flex w-full min-w-0 justify-start"
        }
      >
        {message.role === "user" ? (
          isEditing ? (
            <div className="-mx-4 flex-1 min-w-0 w-[calc(100%+2rem)]">
              <ChatInput
                attachments={composerAttachments}
                value={composerValue}
                onAttachmentsChange={onComposerAttachmentsChange}
                onValueChange={onComposerValueChange}
                onSend={onSendEditedMessage}
                onCancelEdit={onCancelEditingMessage}
                chatModeOptions={chatModeOptions}
                chatModeSelectorDisabled={chatModeSelectorDisabled}
                isEditing
                onChatModeChange={onChatModeChange}
                sendOnEnter={sendMessageOnEnter}
                variant="inline"
                actionButtonMode={
                  _isSending && !editComposerDirty ? "abort" : "send"
                }
                focusSignal={composerFocusSignal}
                disabled={false}
                isStreaming={_isSending && !editComposerDirty}
                onAbort={onAbortStreamingResponse}
                selectedChatMode={selectedChatMode}
                modelOptions={modelOptions}
                modelOptionsLoading={modelOptionsLoading}
                onModelChange={onModelChange}
                onReasoningEffortChange={onReasoningEffortChange}
                reasoningEffort={reasoningEffort}
                reasoningEffortOptions={reasoningEffortOptions}
                selectedModelId={selectedModelId}
                showReasoningEffortSelector={showReasoningEffortSelector}
                workspaceRootPath={workspaceRootPath}
                initialMentionPathMap={editComposerMentionPathMap}
                editClickBoundaryRef={editClickBoundaryRef}
              />
            </div>
          ) : (
            <div className="-mx-4 flex-1 min-w-0 w-[calc(100%+2rem)] max-w-full">
              <UserMessage
                content={message.content}
                onEdit={
                  onEditUserMessage
                    ? () => onEditUserMessage(message.id)
                    : undefined
                }
                onRevert={
                  onRevertUserMessage
                    ? () => onRevertUserMessage(message.id)
                    : undefined
                }
              />
            </div>
          )
        ) : (
          <AssistantMessage
            content={message.content}
            hasSubsequentAssistantText={hasSubsequentAssistantText}
            isConversationStreaming={isConversationStreaming}
            isStreaming={isStreaming}
            onToolDecisionSubmit={(invocation, submission) => {
              onToolDecisionSubmit?.(invocation, submission);
            }}
            reasoningCompletedAt={message.reasoningCompletedAt}
            reasoningContent={message.reasoningContent}
            showCopyButton={showCopyButton}
            timestamp={message.timestamp}
            toolInvocations={message.toolInvocations}
            waitingIndicatorVariant={waitingIndicatorVariant}
            isTextStreaming={isTextStreaming}
            workspaceRootPath={workspaceRootPath}
          />
        )}
      </div>
    );
  },
  (previousProps, nextProps) => {
    if (
      previousProps.message !== nextProps.message ||
      previousProps.hasSubsequentAssistantText !== nextProps.hasSubsequentAssistantText ||
      previousProps.isConversationStreaming !== nextProps.isConversationStreaming ||
      previousProps.isEditing !== nextProps.isEditing ||
      previousProps.isStreaming !== nextProps.isStreaming ||
      previousProps.showCopyButton !== nextProps.showCopyButton ||
      previousProps.waitingIndicatorVariant !==
        nextProps.waitingIndicatorVariant ||
      previousProps.isTextStreaming !== nextProps.isTextStreaming
    ) {
      return false;
    }

    if (previousProps.message.role !== "user") {
      return true;
    }

    if (!previousProps.isEditing && !nextProps.isEditing) {
      return true;
    }

    return (
      previousProps.composerValue === nextProps.composerValue &&
      previousProps.composerAttachments === nextProps.composerAttachments &&
      previousProps.composerFocusSignal === nextProps.composerFocusSignal &&
      previousProps.editComposerMentionPathMap === nextProps.editComposerMentionPathMap &&
      previousProps.isSending === nextProps.isSending &&
      previousProps.chatModeSelectorDisabled ===
        nextProps.chatModeSelectorDisabled &&
      previousProps.selectedChatMode === nextProps.selectedChatMode &&
      previousProps.reasoningEffort === nextProps.reasoningEffort &&
      previousProps.selectedModelId === nextProps.selectedModelId &&
      previousProps.sendMessageOnEnter === nextProps.sendMessageOnEnter &&
      previousProps.showReasoningEffortSelector ===
        nextProps.showReasoningEffortSelector &&
      previousProps.modelOptionsLoading === nextProps.modelOptionsLoading &&
      previousProps.modelOptions === nextProps.modelOptions
    );
  },
);

export function MessageList({
  chatModeOptions,
  chatModeSelectorDisabled,
  conversationId,
  composerAttachments,
  editComposerDirty = false,
  editComposerMentionPathMap,
  messages,
  onAbortStreamingResponse,
  editingMessageId = null,
  onEditUserMessage,
  onRevertUserMessage,
  composerValue,
  onComposerValueChange,
  onComposerAttachmentsChange,
  onSendEditedMessage,
  onCancelEditingMessage,
  onChatModeChange,
  onToolDecisionSubmit,
  composerFocusSignal,
  isSending = false,
  selectedChatMode,
  modelOptions,
  modelOptionsLoading,
  onModelChange,
  onReasoningEffortChange,
  reasoningEffort,
  reasoningEffortOptions,
  selectedModelId,
  sendMessageOnEnter,
  showReasoningEffortSelector = false,
  streamingAssistantMessageId = null,
  streamingWaitingIndicatorVariant = null,
  streamingTextActive = false,
  workspaceRootPath = null,
}: MessageListProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isConversationStreaming = streamingAssistantMessageId !== null;
  const visibleMessages = messages.filter((message) =>
    isVisibleTranscriptMessage(message),
  );
  const subsequentAssistantTextByMessageId = useMemo(() => {
    const map = new Map<string, boolean>();
    let hasAssistantTextLaterInTranscript = false;

    for (let index = visibleMessages.length - 1; index >= 0; index -= 1) {
      const message = visibleMessages[index];
      map.set(message.id, hasAssistantTextLaterInTranscript);

      if (message.role !== 'assistant') {
        continue;
      }

      const normalizedAssistantContent = normalizeAssistantMessageContent(message);
      const hasAssistantTextInMessage =
        normalizedAssistantContent.content.trim().length > 0 ||
        normalizedAssistantContent.reasoningContent.trim().length > 0;

      if (hasAssistantTextInMessage) {
        hasAssistantTextLaterInTranscript = true;
      }
    }

    return map;
  }, [visibleMessages]);

  useLayoutEffect(() => {
    if (!editingMessageId) {
      return;
    }

    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    const targetMessage = container.querySelector<HTMLElement>(
      `[data-message-id="${editingMessageId}"]`,
    );
    if (!targetMessage) {
      return;
    }

    targetMessage.scrollIntoView({
      block: "center",
      behavior: "auto",
    });
  }, [conversationId, editingMessageId, visibleMessages.length]);

  return (
    <div
      ref={scrollContainerRef}
      className="scroll-stable flex-1 w-full overflow-y-auto"
    >
      <div className="chat-column mx-auto space-y-2.5 px-4 pb-6 pt-6">
        {visibleMessages.map((msg, index) => {
          const showCopyButton =
            editingMessageId === null &&
            msg.role === "assistant" &&
            (index === visibleMessages.length - 1 ||
              visibleMessages[index + 1]?.role !== "assistant");

          return (
            <MessageRow
              key={msg.id}
              chatModeOptions={chatModeOptions}
              chatModeSelectorDisabled={chatModeSelectorDisabled}
              composerAttachments={composerAttachments}
              composerFocusSignal={composerFocusSignal}
              composerValue={composerValue}
              editComposerDirty={editComposerDirty}
              editComposerMentionPathMap={editComposerMentionPathMap}
              hasSubsequentAssistantText={
                subsequentAssistantTextByMessageId.get(msg.id) ?? false
              }
              isConversationStreaming={isConversationStreaming}
              isEditing={editingMessageId === msg.id}
              isSending={isSending}
              isStreaming={streamingAssistantMessageId === msg.id}
              message={msg}
              showCopyButton={showCopyButton}
              onAbortStreamingResponse={onAbortStreamingResponse}
              onCancelEditingMessage={onCancelEditingMessage}
              onChatModeChange={onChatModeChange}
              onToolDecisionSubmit={onToolDecisionSubmit}
              onComposerAttachmentsChange={onComposerAttachmentsChange}
              onComposerValueChange={onComposerValueChange}
              onEditUserMessage={onEditUserMessage}
              onRevertUserMessage={onRevertUserMessage}
              onModelChange={onModelChange}
              onReasoningEffortChange={onReasoningEffortChange}
              onSendEditedMessage={onSendEditedMessage}
              selectedChatMode={selectedChatMode}
              modelOptions={modelOptions}
              modelOptionsLoading={modelOptionsLoading}
              reasoningEffort={reasoningEffort}
              reasoningEffortOptions={reasoningEffortOptions}
              selectedModelId={selectedModelId}
              sendMessageOnEnter={sendMessageOnEnter}
              showReasoningEffortSelector={showReasoningEffortSelector}
              editClickBoundaryRef={scrollContainerRef}
              waitingIndicatorVariant={
                streamingAssistantMessageId === msg.id
                  ? (streamingWaitingIndicatorVariant ?? "thinking")
                  : undefined
              }
              isTextStreaming={
                streamingAssistantMessageId === msg.id
                  ? streamingTextActive
                  : false
              }
              workspaceRootPath={workspaceRootPath}
            />
          );
        })}
      </div>
    </div>
  );
}
