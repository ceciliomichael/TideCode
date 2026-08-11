import { useCallback, useEffect, useRef, useState, type ComponentProps, type RefObject } from 'react'
import { ChatInput } from '../../components/ChatInput'
import { EmptyState } from '../../components/EmptyState'
import { MessageList } from '../../components/MessageList'
import { ChatQueueBlock } from '../../components/chat/ChatQueueBlock'
import type { ChatModeOption } from '../../components/chat/ChatModeSelectorField'
import { KanbanBoard } from '../../components/kanban/KanbanBoard'
import type { ChatMessagesController } from '../../hooks/useChatMessages'
import type { ChatRuntimeConfigState } from '../../hooks/useChatRuntimeConfig'
import type { GitBranchStateController } from '../../hooks/useGitBranchState'
import type {
  AppTerminalExecutionMode,
  ChatAttachment,
  ChatCompactionLifecycleState,
  ChatCompactionMarker,
  CodexUsageSnapshot,
  ContextUsageEstimate,
  QueuedMessage,
  WorkspaceRefactorCandidate,
} from '../../types/chat'
import { getLatestCompletedPlanPresentation, shouldAutoOpenPlanPreview } from '../../lib/planPresentation'
import type { ChatWorkspaceUiState } from './useChatWorkspaceUiState'

type ChatInputProps = ComponentProps<typeof ChatInput>
type MessageListProps = ComponentProps<typeof MessageList>

interface ChatConversationSurfaceProps {
  activeWorkspacePath: string | null
  chatMessages: ChatMessagesController
  chatModeOptions: readonly ChatModeOption[]
  chatRuntimeConfig: ChatRuntimeConfigState
  codexUsage: CodexUsageSnapshot | null | undefined
  compactionMarkers: ChatCompactionMarker[]
  contextUsage: ContextUsageEstimate | null
  gitBranchState: GitBranchStateController
  handleCancelEditingMessage: MessageListProps['onCancelEditingMessage']
  handleCompressChat: () => void
  handleEditUserMessage: MessageListProps['onEditUserMessage']
  handleImplementPlan: (planPath?: string) => void
  handleRevertUserMessage: MessageListProps['onRevertUserMessage']
  handleSendEditedMessage: MessageListProps['onSendEditedMessage']
  handleSendMainMessage: ChatInputProps['onSend']
  handleToolDecisionSubmit: MessageListProps['onToolDecisionSubmit']
  isCompressingChat: boolean
  liveCompaction: ChatCompactionLifecycleState | null
  isKanbanBoardOpen: boolean
  messageListBoundaryRef: RefObject<HTMLDivElement>
  onQueueMessage: (value: string, attachments: ChatAttachment[]) => void
  onTerminalExecutionModeChange: (mode: AppTerminalExecutionMode) => void
  queuedMessages: QueuedMessage[]
  refactorCandidates: WorkspaceRefactorCandidate[]
  refactorCandidatesLoading: boolean
  removeQueuedMessage: (messageId: string) => void
  reorderQueuedMessages: (sourceId: string, targetId: string) => void
  selectorOptions: ChatInputProps['modelOptions']
  sendMessageOnEnter: boolean
  showImplementPlanButton: boolean
  showQueueBlock: boolean
  terminalExecutionMode: AppTerminalExecutionMode
  updateQueuedMessage: (messageId: string, value: string, attachments?: ChatAttachment[]) => void
  workspaceState: ChatWorkspaceUiState
}

export function ChatConversationSurface({
  activeWorkspacePath,
  chatMessages,
  chatModeOptions,
  chatRuntimeConfig,
  codexUsage,
  compactionMarkers,
  contextUsage,
  gitBranchState,
  handleCancelEditingMessage,
  handleCompressChat,
  handleEditUserMessage,
  handleImplementPlan,
  handleRevertUserMessage,
  handleSendEditedMessage,
  handleSendMainMessage,
  handleToolDecisionSubmit,
  isCompressingChat,
  liveCompaction,
  isKanbanBoardOpen,
  messageListBoundaryRef,
  onQueueMessage,
  onTerminalExecutionModeChange,
  queuedMessages,
  refactorCandidates,
  refactorCandidatesLoading,
  removeQueuedMessage,
  reorderQueuedMessages,
  selectorOptions,
  sendMessageOnEnter,
  showImplementPlanButton,
  showQueueBlock,
  terminalExecutionMode,
  updateQueuedMessage,
  workspaceState,
}: ChatConversationSurfaceProps) {
  const [followLatestSignal, setFollowLatestSignal] = useState(0)
  const requestFollowLatest = useCallback(() => {
    setFollowLatestSignal((currentSignal) => currentSignal + 1)
  }, [])
  const handleSendMainMessageAndFollow = useCallback<ChatInputProps['onSend']>(
    (value, attachments) => {
      requestFollowLatest()
      handleSendMainMessage(value, attachments)
    },
    [handleSendMainMessage, requestFollowLatest],
  )
  const handleSendEditedMessageAndFollow = useCallback<MessageListProps['onSendEditedMessage']>(
    (value, attachments) => {
      requestFollowLatest()
      handleSendEditedMessage(value, attachments)
    },
    [handleSendEditedMessage, requestFollowLatest],
  )
  const latestPlanPresentation = getLatestCompletedPlanPresentation(chatMessages.messages)
  const latestPlanKey = latestPlanPresentation
    ? `${latestPlanPresentation.relativePath}:${latestPlanPresentation.updatedAt}`
    : null
  const latestPlanRelativePath = latestPlanPresentation?.relativePath ?? null
  const isRevertingPlan = chatMessages.isEditingMessage && chatMessages.revertedPlanPaths.length > 0
  const { handleOpenWorkspacePlanPreview } = workspaceState
  const autoOpenedPlanRef = useRef<{ conversationId: string | null; planKey: string | null }>({
    conversationId: null,
    planKey: null,
  })

  useEffect(() => {
    const conversationId = chatMessages.activeConversationId
    const autoOpenState = autoOpenedPlanRef.current

    if (autoOpenState.conversationId !== conversationId) {
      autoOpenState.conversationId = conversationId
      autoOpenState.planKey = latestPlanKey
      return
    }

    if (latestPlanRelativePath === null || latestPlanKey === null) {
      autoOpenState.planKey = null
      return
    }

    if (!shouldAutoOpenPlanPreview(autoOpenState.planKey, latestPlanKey, isRevertingPlan)) {
      autoOpenState.planKey = latestPlanKey
      return
    }

    autoOpenState.planKey = latestPlanKey
    handleOpenWorkspacePlanPreview(latestPlanRelativePath)
  }, [
    chatMessages.activeConversationId,
    chatMessages.isEditingMessage,
    chatMessages.revertedPlanPaths.length,
    isRevertingPlan,
    latestPlanKey,
    latestPlanRelativePath,
    handleOpenWorkspacePlanPreview,
  ])

  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col items-center overflow-hidden"
      style={{ display: workspaceState.isTerminalFullScreen && workspaceState.isTerminalOpen ? 'none' : 'flex' }}
    >
      <div className="flex min-h-0 w-full flex-1 flex-col">
        {isKanbanBoardOpen ? (
          <KanbanBoard workspacePath={activeWorkspacePath} messages={chatMessages.messages} />
        ) : (
          <>
            {chatMessages.error ? (
              <div className="chat-input-shell mx-auto rounded-2xl border border-danger-border bg-danger-surface px-4 py-3 text-sm text-danger-foreground">
                {chatMessages.error}
              </div>
            ) : null}
            {chatMessages.isLoading ? (
              <div className="flex flex-1 items-center justify-center px-4 text-sm text-subtle-foreground">
                Loading conversations...
              </div>
            ) : chatMessages.messages.length === 0 ? (
              <EmptyState folderName={chatMessages.selectedFolderName} />
            ) : (
              <div ref={messageListBoundaryRef} className="flex min-h-0 flex-1 flex-col">
                <MessageList
                  conversationId={chatMessages.activeConversationId}
                  compactionMarkers={compactionMarkers}
                  liveCompaction={liveCompaction}
                  messages={chatMessages.messages}
                  chatModeOptions={chatModeOptions}
                  editingMessageId={chatMessages.editingMessageId}
                  followLatestSignal={followLatestSignal}
                  editComposerDirty={chatMessages.isEditComposerDirty}
                  editComposerMentionPathMap={chatMessages.editComposerMentionPathMap}
                  onChatModeChange={chatMessages.setSelectedChatMode}
                  onToolDecisionSubmit={handleToolDecisionSubmit}
                  onEditUserMessage={handleEditUserMessage}
                  onRevertUserMessage={handleRevertUserMessage}
                  composerAttachments={chatMessages.editComposerAttachments}
                  composerValue={chatMessages.editComposerValue}
                  onComposerAttachmentsChange={chatMessages.setEditComposerAttachments}
                  onComposerValueChange={chatMessages.setEditComposerValue}
                  onSendEditedMessage={handleSendEditedMessageAndFollow}
                  onAbortStreamingResponse={chatMessages.abortStreamingResponse}
                  onCancelEditingMessage={handleCancelEditingMessage}
                  composerFocusSignal={chatMessages.editComposerFocusSignal}
                  isSending={chatMessages.isSending}
                  modelOptions={selectorOptions}
                  modelOptionsLoading={chatRuntimeConfig.isModelOptionsLoading}
                  onModelChange={chatRuntimeConfig.setSelectedModelId}
                  onReasoningEffortChange={chatRuntimeConfig.setReasoningEffort}
                  reasoningEffort={chatRuntimeConfig.reasoningEffort}
                  reasoningEffortOptions={chatRuntimeConfig.availableReasoningEfforts}
                  selectedChatMode={chatMessages.selectedChatMode}
                  selectedModelId={chatRuntimeConfig.selectedModelId}
                  sendMessageOnEnter={sendMessageOnEnter}
                  showReasoningEffortSelector={chatRuntimeConfig.showReasoningEffortSelector}
                  streamingAssistantMessageId={chatMessages.streamingAssistantMessageId}
                  streamingWaitingIndicatorVariant={chatMessages.streamingWaitingIndicatorVariant}
                  streamingTextActive={chatMessages.isStreamingTextActive}
                  workspaceRootPath={activeWorkspacePath}
                />
              </div>
            )}
          </>
        )}
      </div>
      {!isKanbanBoardOpen ? (
        <div className="flex w-full shrink-0 flex-col items-center pb-4">
          <div className="chat-composer-shell">
            {showQueueBlock ? (
              <div className="chat-queue-shell">
                <ChatQueueBlock
                  queuedMessages={queuedMessages}
                  editCancelBoundaryRef={messageListBoundaryRef}
                  onRemove={removeQueuedMessage}
                  onReorder={reorderQueuedMessages}
                  onUpdate={updateQueuedMessage}
                />
              </div>
            ) : null}
            <div className="chat-input-shell relative">
            {showImplementPlanButton ? (
              <button
                type="button"
                onClick={() => handleImplementPlan()}
                className="absolute -top-[3.25rem] left-1/2 z-10 inline-flex h-11 w-auto max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-2 rounded-2xl border border-border bg-surface px-4 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-surface-muted active:scale-95"
              >
                <span className="truncate">Implement the plan</span>
                <span className="rounded-lg border border-border bg-surface-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  Ctrl + I
                </span>
              </button>
            ) : null}
            <ChatInput
              attachments={chatMessages.mainComposerAttachments}
              contextUsage={contextUsage ?? undefined}
              codexUsage={codexUsage}
              isCompressingChat={isCompressingChat}
              onCompressChat={handleCompressChat}
              refactorCandidates={refactorCandidates}
              refactorCandidatesLoading={refactorCandidatesLoading}
              value={chatMessages.mainComposerValue}
              onAttachmentsChange={chatMessages.setMainComposerAttachments}
              initialMentionPathMap={chatMessages.mainComposerMentionPathMap}
              onValueChange={chatMessages.setMainComposerValue}
              onSend={handleSendMainMessageAndFollow}
              onQueue={onQueueMessage}
              onAbort={chatMessages.abortStreamingResponse}
              chatModeOptions={chatModeOptions}
              isStreaming={chatMessages.isStreamingResponse || chatMessages.isSending}
              sendOnEnter={sendMessageOnEnter}
              disabled={chatMessages.isLoading}
              gitBranchError={gitBranchState.errorMessage}
              gitBranchLoading={gitBranchState.isLoading}
              gitBranchState={gitBranchState.branchState}
              gitBranchSwitching={gitBranchState.isSwitching}
              onChatModeChange={chatMessages.setSelectedChatMode}
              onGitBranchCreate={gitBranchState.createBranch}
              onGitBranchChange={gitBranchState.changeBranch}
              onGitBranchRefresh={gitBranchState.refresh}
              modelOptions={selectorOptions}
              modelOptionsLoading={chatRuntimeConfig.isModelOptionsLoading}
              modelSelectorDisabled={false}
              selectedChatMode={chatMessages.selectedChatMode}
              selectedModelId={chatRuntimeConfig.selectedModelId}
              onModelChange={chatRuntimeConfig.setSelectedModelId}
              onRefactorCandidateSelect={workspaceState.handleOpenWorkspaceFile}
              reasoningEffort={chatRuntimeConfig.reasoningEffort}
              reasoningEffortOptions={chatRuntimeConfig.availableReasoningEfforts}
              reasoningEffortSelectorDisabled={false}
              onReasoningEffortChange={chatRuntimeConfig.setReasoningEffort}
              showRuntimeTargetSelector
              showTerminalExecutionModeSelector
              showReasoningEffortSelector={chatRuntimeConfig.showReasoningEffortSelector}
              terminalExecutionMode={terminalExecutionMode}
              onTerminalExecutionModeChange={onTerminalExecutionModeChange}
              workspaceRootPath={activeWorkspacePath}
            />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
