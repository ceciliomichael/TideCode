import { memo, useMemo, useRef, type RefObject } from "react";
import { isPlanImplementationMessage, isPlanRevisionMessage, isVisibleTranscriptMessage } from "../lib/chatMessageMetadata";
import { normalizeAssistantMessageContent } from "../lib/chatMessageContent";
import type {
  AssistantWaitingIndicatorVariant,
  ChatAttachment,
  ChatCompactionLifecycleState,
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
import { PlanImplementationDivider } from "./chat/PlanImplementationDivider";
import { PlanRevisionDivider } from "./chat/PlanRevisionDivider";
import { hasAssistantWork, splitFinishedAssistantRun } from './chat/assistantWorkGrouping';
import {
  buildAssistantWorkTimeline,
  type AssistantWorkCompactionBoundary,
  type AssistantWorkTimelineEntry,
} from './chat/assistantWorkTimeline';
import { placeCompactionMarkersAfterTranscript } from './chat/compactionMarkerPlacement';
import { resolveLiveCompactionPlacement } from './chat/liveCompactionPlacement';
import { useChatAutoScroll } from "./chat/useChatAutoScroll";
import type { ChatModeOption } from "./chat/ChatModeSelectorField";
import type { ModelSelectorOption } from "./chat/ModelSelectorField";
import type { ToolDecisionSubmission } from "./chat/ToolDecisionRequestCard";

interface MessageListProps {
  chatModeOptions?: readonly ChatModeOption[];
  chatModeSelectorDisabled?: boolean;
  compactionMarkers?: readonly ChatCompactionMarker[];
  liveCompaction?: ChatCompactionLifecycleState | null;
  conversationId: string | null;
  composerAttachments: ChatAttachment[];
  composerValue: string;
  composerFocusSignal?: number;
  editComposerDirty?: boolean;
  editComposerMentionPathMap?: ReadonlyMap<string, string>;
  editingMessageId?: string | null;
  followLatestSignal?: number;
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
  finalizeToolGroups: boolean;
  isCompactionInProgress: boolean;
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
    finalizeToolGroups,
    isCompactionInProgress,
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
          isPlanImplementationMessage(message) ? (
            <PlanImplementationDivider />
          ) : isPlanRevisionMessage(message) ? (
            <PlanRevisionDivider />
          ) : isEditing ? (
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
                attachments={message.attachments}
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
            finalizeToolGroups={finalizeToolGroups}
            hasSubsequentAssistantText={hasSubsequentAssistantText}
            isCompactionInProgress={isCompactionInProgress}
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
      previousProps.finalizeToolGroups !== nextProps.finalizeToolGroups ||
      previousProps.hasSubsequentAssistantText !== nextProps.hasSubsequentAssistantText ||
      previousProps.isCompactionInProgress !== nextProps.isCompactionInProgress ||
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
  liveCompaction = null,
  composerAttachments,
  conversationId,
  editComposerDirty = false,
  editComposerMentionPathMap,
  messages,
  onAbortStreamingResponse,
  editingMessageId = null,
  followLatestSignal = 0,
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
  const visibleMessages = useMemo(
    () => messages.filter(
      (message) =>
        isVisibleTranscriptMessage(message) || isPlanImplementationMessage(message) || isPlanRevisionMessage(message),
    ),
    [messages],
  );
  
  const renderItems = useMemo(() => {
    type RenderItem =
      | { type: 'message'; message: Message; index: number }
      | { type: 'plan_status_divider'; kind: 'implementation' | 'revision'; messageId: string }
      | { type: 'compaction_marker'; marker: ChatCompactionMarker }
      | { type: 'live_compaction'; status: ChatCompactionLifecycleState }
      | {
          type: 'working_group';
          entries: AssistantWorkTimelineEntry[];
          messages: Message[];
          trailingMessage?: { message: Message, index: number };
          startTime: number;
          endTime: number;
          key: string;
        };

    const items: RenderItem[] = [];
    const markerPlacement = placeCompactionMarkersAfterTranscript(visibleMessages, compactionMarkers, {
      preferredMessageId: streamingAssistantMessageId,
    });
    const liveCompactionMarkerIsPersisted = liveCompaction?.phase === 'compacted' &&
      compactionMarkers.some((marker) => marker.compactionId === liveCompaction.compactionId);
    const shouldRenderLiveCompaction = liveCompaction?.phase === 'compacting' ||
      (liveCompaction?.phase === 'compacted' && !liveCompactionMarkerIsPersisted);
    const liveCompactionPlacement = shouldRenderLiveCompaction
      ? resolveLiveCompactionPlacement(visibleMessages, liveCompaction)
      : null;
    let liveCompactionInserted = false;
    let currentAssistantRun: Message[] = [];
    let currentAssistantRunBoundaries: AssistantWorkCompactionBoundary[] = [];
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

    const getTimelineEndTime = (
      workMessages: readonly Message[],
      boundaries: readonly AssistantWorkCompactionBoundary[],
    ) => {
      let endTime = getWorkEndTime(workMessages[workMessages.length - 1]);
      for (const boundary of boundaries) {
        if (boundary.type === 'compaction_marker') {
          endTime = Math.max(endTime, boundary.marker.createdAt);
        }
      }
      return endTime;
    };

    const pushCompactionBoundary = (boundary: AssistantWorkCompactionBoundary) => {
      if (boundary.type === 'compaction_marker') {
        items.push({ marker: boundary.marker, type: 'compaction_marker' });
      } else {
        items.push({ status: boundary.status, type: 'live_compaction' });
      }
    };

    const resetCurrentAssistantRun = () => {
      currentAssistantRun = [];
      currentAssistantRunBoundaries = [];
      currentAssistantRunStartIndex = -1;
    };

    const processFinishedAssistantRun = () => {
      if (currentAssistantRun.length === 0) return;

      const assistantRun = currentAssistantRun;
      const assistantRunBoundaries = currentAssistantRunBoundaries;
      const assistantRunStartIndex = currentAssistantRunStartIndex;
      resetCurrentAssistantRun();

      const presentation = splitFinishedAssistantRun(assistantRun);
      const lastMessageIndex = assistantRunStartIndex + assistantRun.length - 1;

      if (presentation.workingMessages.length > 0) {
        const timeline = buildAssistantWorkTimeline(
          presentation.workingMessages,
          assistantRunStartIndex,
          assistantRunBoundaries,
        );
        const inlineBoundaryCount = assistantRunBoundaries.length - timeline.overflowBoundaries.length;
        const inlineBoundaries = inlineBoundaryCount > 0
          ? assistantRunBoundaries.filter((boundary) => boundary.afterMessageCount <= presentation.workingMessages.length)
          : [];

        items.push({
          type: 'working_group',
          entries: timeline.entries,
          messages: presentation.workingMessages,
          trailingMessage: presentation.trailingMessage
            ? {
                message: presentation.trailingMessage,
                index: lastMessageIndex,
              }
            : undefined,
          startTime: presentation.workingMessages[0].timestamp,
          endTime: getTimelineEndTime(presentation.workingMessages, inlineBoundaries),
          key: `wg-${presentation.workingMessages[0].id}`,
        });

        for (const boundary of timeline.overflowBoundaries) {
          pushCompactionBoundary(boundary);
        }
      } else {
        if (presentation.trailingMessage) {
          items.push({
            type: 'message',
            message: presentation.trailingMessage,
            index: lastMessageIndex,
          });
        }
        for (const boundary of assistantRunBoundaries) {
          pushCompactionBoundary(boundary);
        }
      }
    };

    const processStreamingAssistantRun = () => {
      if (currentAssistantRun.length === 0) return;

      const assistantRun = currentAssistantRun;
      const assistantRunBoundaries = currentAssistantRunBoundaries;
      const assistantRunStartIndex = currentAssistantRunStartIndex;
      resetCurrentAssistantRun();
      const timeline = buildAssistantWorkTimeline(assistantRun, assistantRunStartIndex, assistantRunBoundaries);

      items.push({
        type: 'working_group',
        entries: timeline.entries,
        messages: assistantRun,
        startTime: assistantRun[0].timestamp,
        endTime: getTimelineEndTime(assistantRun, assistantRunBoundaries),
        key: `wg-${assistantRun[0].id}`,
      });

      for (const boundary of timeline.overflowBoundaries) {
        pushCompactionBoundary(boundary);
      }
    };

    const insertLiveCompaction = (allowInline: boolean) => {
      if (!shouldRenderLiveCompaction || !liveCompaction || liveCompactionInserted) {
        return;
      }

      const boundary: AssistantWorkCompactionBoundary = {
        afterMessageCount: currentAssistantRun.length,
        status: liveCompaction,
        type: 'live_compaction',
      };
      if (allowInline && currentAssistantRun.length > 0 && hasAssistantWork(currentAssistantRun)) {
        currentAssistantRunBoundaries.push(boundary);
      } else {
        if (currentAssistantRun.length > 0) {
          processFinishedAssistantRun();
        }
        pushCompactionBoundary(boundary);
      }
      liveCompactionInserted = true;
    };

    for (let i = 0; i < visibleMessages.length; i++) {
      const msg = visibleMessages[i];
      const markersBeforeMessage = markerPlacement.markersBeforeMessageId.get(msg.id) ?? [];

      if (markersBeforeMessage.length > 0) {
        const canInlineMarkers =
          msg.role === 'assistant' &&
          currentAssistantRun.length > 0 &&
          hasAssistantWork(currentAssistantRun);

        if (canInlineMarkers) {
          for (const marker of markersBeforeMessage) {
            currentAssistantRunBoundaries.push({
              afterMessageCount: currentAssistantRun.length,
              marker,
              type: 'compaction_marker',
            });
          }
        } else {
          if (currentAssistantRun.length > 0) {
            processFinishedAssistantRun();
          }
          for (const marker of markersBeforeMessage) {
            items.push({ marker, type: 'compaction_marker' });
          }
        }
      }

      if (liveCompactionPlacement?.beforeMessageId === msg.id) {
        insertLiveCompaction(msg.role === 'assistant');
      }

      if (isPlanImplementationMessage(msg) || isPlanRevisionMessage(msg)) {
        if (currentAssistantRun.length > 0) {
          processFinishedAssistantRun();
        }

        items.push({
          kind: isPlanImplementationMessage(msg) ? 'implementation' : 'revision',
          messageId: msg.id,
          type: 'plan_status_divider',
        });
        continue;
      }

      if (msg.role === 'user') {
        if (currentAssistantRun.length > 0) {
          processFinishedAssistantRun();
        }
        items.push({ type: 'message', message: msg, index: i });
      } else {
        if (currentAssistantRun.length === 0) {
          currentAssistantRunStartIndex = i;
        }
        currentAssistantRun.push(msg);
      }
    }

    if (liveCompactionPlacement?.trailing && !liveCompactionInserted) {
      insertLiveCompaction(true);
    }

    if (currentAssistantRun.length > 0) {
      const isFinished = !isConversationStreaming;
      if (isFinished) {
        processFinishedAssistantRun();
      } else if (currentAssistantRunBoundaries.length > 0) {
        processStreamingAssistantRun();
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
  }, [compactionMarkers, isConversationStreaming, liveCompaction, streamingAssistantMessageId, visibleMessages]);

  useChatAutoScroll({
    conversationId,
    followLatestSignal,
    messages: visibleMessages,
    scrollContainerRef,
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

  const renderMessageRow = (msg: Message, index: number, finalizeToolGroups = false) => {
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
        finalizeToolGroups={finalizeToolGroups}
        hasSubsequentAssistantText={
          subsequentAssistantTextByMessageId.get(msg.id) ?? false
        }
        isCompactionInProgress={liveCompaction?.phase === 'compacting'}
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
      className="chat-scroll-viewport scroll-stable min-h-0 flex-1 w-full overflow-y-auto"
    >
      <div className="chat-column mx-auto space-y-2.5 px-4 pb-6 pt-6">
        {renderItems.map((item) => {
          if (item.type === 'plan_status_divider') {
            return (
              <div
                key={`plan-status-${item.messageId}`}
                data-message-id={item.messageId}
                className="flex w-full min-w-0 justify-start"
              >
                {item.kind === 'implementation' ? <PlanImplementationDivider /> : <PlanRevisionDivider />}
              </div>
            );
          }

          if (item.type === 'compaction_marker') {
            return <CompactionDivider key={`compaction-${item.marker.compactionId}`} marker={item.marker} />;
          }

          if (item.type === 'live_compaction') {
            return (
              <CompactionDivider
                key={`live-compaction-${item.status.phase}-${item.status.phase === 'compacting' ? item.status.attemptId : item.status.compactionId}`}
                phase={item.status.phase}
              />
            );
          }

          if (item.type === 'working_group') {
            const isWorkingGroupStreaming =
              streamingAssistantMessageId !== null &&
              item.messages.some(
                (m) =>
                  m.id === streamingAssistantMessageId ||
                  m.id.startsWith(`${streamingAssistantMessageId}-`),
              );
            const latestCompactionBoundaryIndex = item.entries.reduce(
              (latestIndex, entry, entryIndex) =>
                entry.type === 'message' ? latestIndex : entryIndex,
              -1,
            );

            return (
              <div key={item.key} className="flex flex-col gap-1.5 w-full">
                <WorkingBlock
                  startTime={item.startTime}
                  endTime={item.endTime}
                  isStreaming={isWorkingGroupStreaming}
                >
                  {item.entries.map((entry, entryIndex) => {
                    if (entry.type === 'message') {
                      return renderMessageRow(
                        entry.message,
                        entry.index,
                        latestCompactionBoundaryIndex >= 0 && entryIndex < latestCompactionBoundaryIndex,
                      );
                    }
                    if (entry.type === 'compaction_marker') {
                      return (
                        <CompactionDivider
                          key={`compaction-${entry.marker.compactionId}`}
                          marker={entry.marker}
                        />
                      );
                    }
                    return (
                      <CompactionDivider
                        key={`live-compaction-${entry.status.phase}-${entry.status.phase === 'compacting' ? entry.status.attemptId : entry.status.compactionId}`}
                        phase={entry.status.phase}
                      />
                    );
                  })}
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
