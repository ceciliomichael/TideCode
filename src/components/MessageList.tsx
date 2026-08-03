import { memo, useMemo, useRef, type RefObject } from "react";
import { isVisibleTranscriptMessage } from "../lib/chatMessageMetadata";
import { normalizeAssistantMessageContent } from "../lib/chatMessageContent";
import type {
  AssistantWaitingIndicatorVariant,
  ChatAttachment,
  ChatCompactionMarker,
  ChatMode,
  Message,
  ReasoningEffort,
  ToolInvocationTrace,
} from "../types/chat";
import { AssistantMessage } from "./AssistantMessage";
import { ChatInput } from "./ChatInput";
import { UserMessage } from "./UserMessage";
import { WorkingBlock } from "./chat/WorkingBlock";
import { CompactionDivider } from "./chat/CompactionDivider";
import { splitFinishedAssistantRun } from './chat/assistantWorkGrouping';
import { placeCompactionMarkersAfterTranscript } from './chat/compactionMarkerPlacement';
import { useChatAutoScroll } from "./chat/useChatAutoScroll";
import type { ChatModeOption } from "./chat/ChatModeSelectorField";
import type { ModelSelectorOption } from "./chat/ModelSelectorField";
import type { ToolDecisionSubmission } from "./chat/ToolDecisionRequestCard";

interface MessageListProps {
  chatModeOptions?: readonly ChatModeOption[];
  chatModeSelectorDisabled?: boolean;
  compactionMarkers?: readonly ChatCompactionMarker[];
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
            <div className="-mx-4 flex-1 min-w-0 w-[calc(100%+2rem)]">
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
  compactionMarkers = [],
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
  
  const renderItems = useMemo(() => {
    type RenderItem =
      | { type: 'message'; message: Message; index: number }
      | { type: 'compaction_marker'; marker: ChatCompactionMarker }
      | { type: 'working_group'; messages: Message[]; trailingMessage?: { message: Message, index: number }; startTime: number; endTime: number; startIndex: number; key: string };

    const items: RenderItem[] = [];
    const markerPlacement = placeCompactionMarkersAfterTranscript(visibleMessages, compactionMarkers);
    let currentAssistantRun: Message[] = [];
    let currentAssistantRunStartIndex = -1;

    const getWorkEndTime = (msg: Message): number => {
      let endTime = msg.timestamp;
      if (msg.reasoningCompletedAt !== undefined) {
        endTime = Math.max(endTime, msg.reasoningCompletedAt);
      }
      if (msg.toolInvocations) {
        for (const tool of msg.toolInvocations) {
          if (tool.completedAt !== undefined) {
            endTime = Math.max(endTime, tool.completedAt);
          }
        }
      }
      return endTime;
    };

    const processFinishedAssistantRun = () => {
      if (currentAssistantRun.length === 0) return;

      const presentation = splitFinishedAssistantRun(currentAssistantRun);
      const lastMessageIndex = currentAssistantRunStartIndex + currentAssistantRun.length - 1;

      if (presentation.workingMessages.length > 0) {
        items.push({
          type: 'working_group',
          messages: presentation.workingMessages,
          trailingMessage: presentation.trailingMessage
            ? {
                message: presentation.trailingMessage,
                index: lastMessageIndex,
              }
            : undefined,
          startTime: presentation.workingMessages[0].timestamp,
          endTime: getWorkEndTime(presentation.workingMessages[presentation.workingMessages.length - 1]),
          startIndex: currentAssistantRunStartIndex,
          key: `wg-${presentation.workingMessages[0].id}`,
        });
        return;
      }

      if (presentation.trailingMessage) {
        items.push({
          type: 'message',
          message: presentation.trailingMessage,
          index: lastMessageIndex,
        });
      }
    };

    for (let i = 0; i < visibleMessages.length; i++) {
      const msg = visibleMessages[i];
      const markersBeforeMessage = markerPlacement.markersBeforeMessageId.get(msg.id) ?? [];

      if (markersBeforeMessage.length > 0) {
        if (currentAssistantRun.length > 0) {
          processFinishedAssistantRun();
          currentAssistantRun = [];
          currentAssistantRunStartIndex = -1;
        }

        for (const marker of markersBeforeMessage) {
          items.push({ marker, type: 'compaction_marker' });
        }
      }

      if (msg.role === 'user') {
        if (currentAssistantRun.length > 0) {
          processFinishedAssistantRun();
          currentAssistantRun = [];
          currentAssistantRunStartIndex = -1;
        }
        items.push({ type: 'message', message: msg, index: i });
      } else {
        if (currentAssistantRun.length === 0) {
          currentAssistantRunStartIndex = i;
        }
        currentAssistantRun.push(msg);
      }
    }

    if (currentAssistantRun.length > 0) {
      const isFinished = !isConversationStreaming;
      if (isFinished) {
        processFinishedAssistantRun();
      } else {
        for (let j = 0; j < currentAssistantRun.length; j++) {
          items.push({
            type: 'message',
            message: currentAssistantRun[j],
            index: currentAssistantRunStartIndex + j
          });
        }
      }
    }

    for (const marker of markerPlacement.trailingMarkers) {
      items.push({ marker, type: 'compaction_marker' });
    }
    
    return items;
  }, [compactionMarkers, isConversationStreaming, visibleMessages]);

  useChatAutoScroll({
    conversationId,
    messages: visibleMessages,
    scrollContainerRef,
    shouldAutoScroll: isConversationStreaming,
  });
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

  const renderMessageRow = (msg: Message, index: number) => {
    const showCopyButton =
      editingMessageId === null &&
      msg.role === "assistant" &&
      (index === visibleMessages.length - 1 ||
        visibleMessages[index + 1]?.role !== "assistant");

    const isMsgStreaming =
      streamingAssistantMessageId !== null &&
      (msg.id === streamingAssistantMessageId ||
        msg.id.startsWith(`${streamingAssistantMessageId}-`));

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
        isStreaming={isMsgStreaming}
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
          isMsgStreaming
            ? (streamingWaitingIndicatorVariant ?? "thinking")
            : undefined
        }
        isTextStreaming={
          isMsgStreaming
            ? streamingTextActive
            : false
        }
        workspaceRootPath={workspaceRootPath}
      />
    );
  };

  return (
    <div
      ref={scrollContainerRef}
      className="chat-scroll-viewport scroll-stable flex-1 w-full overflow-y-auto"
    >
      <div className="chat-column mx-auto space-y-2.5 px-4 pb-6 pt-6">
        {renderItems.map((item) => {
          if (item.type === 'compaction_marker') {
            return <CompactionDivider key={`compaction-${item.marker.compactionId}`} marker={item.marker} />;
          }

          if (item.type === 'working_group') {
            const isWorkingGroupStreaming =
              streamingAssistantMessageId !== null &&
              item.messages.some(
                (m) =>
                  m.id === streamingAssistantMessageId ||
                  m.id.startsWith(`${streamingAssistantMessageId}-`),
              );

            return (
              <div key={item.key} className="flex flex-col gap-1.5 w-full">
                <WorkingBlock
                  startTime={item.startTime}
                  endTime={item.endTime}
                  isStreaming={isWorkingGroupStreaming}
                >
                  {item.messages.map((msg, idx) => renderMessageRow(msg, item.startIndex + idx))}
                </WorkingBlock>
                {item.trailingMessage ? renderMessageRow(item.trailingMessage.message, item.trailingMessage.index) : null}
              </div>
            );
          } else {
            return renderMessageRow(item.message, item.index);
          }
        })}
      </div>
    </div>
  );
}
