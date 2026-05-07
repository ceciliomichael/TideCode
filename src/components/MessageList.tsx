import { memo, useMemo, useRef, type RefObject } from "react";
import { isVisibleTranscriptMessage } from "../lib/chatMessageMetadata";
import { groupVisibleTranscriptMessages, type TranscriptRenderEntry } from "./chat/assistantTurnGrouping";
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
import { useChatAutoScroll } from "./chat/useChatAutoScroll";
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
  isConversationStreaming: boolean;
  isSending: boolean;
  isStreaming: boolean;
  isTextStreaming: boolean;
  message: Message;
  assistantMessages?: readonly Message[];
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
    isConversationStreaming,
    isEditing,
    isSending: _isSending,
    isStreaming,
    isTextStreaming,
    message,
    assistantMessages,
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
            isComplete={!isStreaming}
            isConversationStreaming={isConversationStreaming}
            isStreaming={isStreaming}
            isTextStreaming={isTextStreaming}
            messages={assistantMessages ?? [message]}
            showCopyButton={showCopyButton}
            waitingIndicatorVariant={waitingIndicatorVariant}
            onToolDecisionSubmit={(invocation, submission) => {
              onToolDecisionSubmit?.(invocation, submission);
            }}
            workspaceRootPath={workspaceRootPath}
          />
        )}
      </div>
    );
  },
  (previousProps, nextProps) => {
    if (
      previousProps.message !== nextProps.message ||
      previousProps.assistantMessages !== nextProps.assistantMessages ||
      previousProps.isConversationStreaming !== nextProps.isConversationStreaming ||
      previousProps.isEditing !== nextProps.isEditing ||
      previousProps.isStreaming !== nextProps.isStreaming ||
      previousProps.isTextStreaming !== nextProps.isTextStreaming ||
      previousProps.showCopyButton !== nextProps.showCopyButton ||
      previousProps.waitingIndicatorVariant !==
        nextProps.waitingIndicatorVariant
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
  composerAttachments,
  conversationId,
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
  const renderEntries: TranscriptRenderEntry[] = useMemo(
    () => groupVisibleTranscriptMessages(visibleMessages),
    [visibleMessages],
  );
  useChatAutoScroll({
    conversationId,
    messages: visibleMessages,
    scrollContainerRef,
    shouldAutoScroll: isConversationStreaming,
  });

  return (
    <div
      ref={scrollContainerRef}
      className="chat-scroll-viewport scroll-stable flex-1 w-full overflow-y-auto"
    >
      <div className="chat-column mx-auto space-y-2.5 px-4 pb-6 pt-6">
        {renderEntries.map((entry, index) => {
          const showCopyButton =
            editingMessageId === null &&
            entry.kind === "assistant" &&
            index === renderEntries.length - 1;
          const assistantMessages =
            entry.kind === "assistant" ? entry.messages : undefined;
          const message = entry.kind === "assistant"
            ? entry.messages[entry.messages.length - 1]
            : entry.message;

          return (
          <MessageRow
            key={entry.kind === "assistant" ? entry.messages.map((message) => message.id).join(":") : entry.message.id}
              chatModeOptions={chatModeOptions}
              chatModeSelectorDisabled={chatModeSelectorDisabled}
              composerAttachments={composerAttachments}
              composerFocusSignal={composerFocusSignal}
              composerValue={composerValue}
              editComposerDirty={editComposerDirty}
              editComposerMentionPathMap={editComposerMentionPathMap}
              isConversationStreaming={isConversationStreaming}
              isEditing={entry.kind === "user" && editingMessageId === entry.message.id}
              isSending={isSending}
              isStreaming={
                entry.kind === "assistant"
                  ? assistantMessages?.some((assistantMessage) => assistantMessage.id === streamingAssistantMessageId) ?? false
                  : false
              }
              isTextStreaming={
                entry.kind === "assistant" &&
                assistantMessages?.some((assistantMessage) => assistantMessage.id === streamingAssistantMessageId)
                  ? streamingTextActive
                  : false
              }
              message={message}
              assistantMessages={assistantMessages}
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
                entry.kind === "assistant" &&
                assistantMessages?.some((assistantMessage) => assistantMessage.id === streamingAssistantMessageId)
                  ? (streamingWaitingIndicatorVariant ?? "thinking")
                  : undefined
              }
              workspaceRootPath={workspaceRootPath}
            />
          );
        })}
      </div>
    </div>
  );
}
