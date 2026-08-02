import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChatHeader } from '../../components/ChatHeader'
import { CommitModal } from '../../components/commit/CommitModal'
import { CommitSuccessDialog } from '../../components/commit/CommitSuccessDialog'
import type { DiffPanelScope } from '../../components/chat/ConversationDiffPanel'
import { AppWorkspaceShell } from '../../components/layout/AppWorkspaceShell'
import { WorkspaceFloatingControls } from '../../components/layout/WorkspaceFloatingControls'
import { WorkspacePanel } from '../../components/layout/WorkspacePanel'
import { SidebarPanel } from '../../components/sidebar/SidebarPanel'
import { ALL_PROJECTS_FILTER_ID } from '../../components/sidebar/sidebarProjectThreads'
import { WorkspaceTerminalPanel } from '../../components/chat/WorkspaceTerminalPanel'
import { useChatContextUsage } from '../../hooks/useChatContextUsage'
import { useChatCompactionMarkers } from '../../hooks/useChatCompactionMarkers'
import type { ChatMessagesController } from '../../hooks/useChatMessages'
import type { ChatRuntimeConfigState } from '../../hooks/useChatRuntimeConfig'
import type { ChatInterfaceControllerState } from '../../hooks/useChatInterfaceController'
import type { GitBranchStateController } from '../../hooks/useGitBranchState'
import type { GitCommitController } from '../../hooks/useGitCommit'
import type { GitDiffSnapshotController } from '../../hooks/useGitDiffSnapshot'
import { useWorkspaceRefactorCandidates } from '../../hooks/useWorkspaceRefactorCandidates'
import { useChatMessageQueue } from './useChatMessageQueue'
import {
  canInterruptStreamForSteer,
  getLatestSuccessfulToolCompletionSignal,
} from './chatSteerFollowUp'
import type { QueuedMessageAutoSendReason } from './chatQueueAutoSend'
import { useChatCompression } from './useChatCompression'
import type { ChatWorkspaceUiState } from './useChatWorkspaceUiState'
import type { AppSettings, ChatAttachment, CodexUsageSnapshot } from '../../types/chat'
import type { ResolvedTheme } from '../../lib/theme'
import { resolveTaskModelSelection } from '../../lib/taskModelSelection'
import { ChatWorkspaceHeaderControls } from './ChatWorkspaceHeaderControls'
import { ChatWorkspaceSidePanels } from './ChatWorkspaceSidePanels'
import { useResizableChatPanel } from './useResizableChatPanel'
import { ChatConversationSurface } from './ChatConversationSurface'
import { useChatMessageActions } from './useChatMessageActions'
import { useConversationNavigationActions } from './useConversationNavigationActions'
import { buildRuntimeSelection, CHAT_MODE_OPTIONS } from './chatInterfaceRuntime'

type ChatWorkspaceViewMode = 'chat' | 'kanban'

interface ChatInterfaceContentProps {
  chatMessages: ChatMessagesController
  chatRuntimeConfig: ChatRuntimeConfigState
  diffPanelExpandedFilePaths: readonly string[]
  diffPanelSelectedScope: DiffPanelScope
  gitBranchState: GitBranchStateController
  gitCommitState: GitCommitController
  gitDiffSnapshot: GitDiffSnapshotController
  interfaceController: ChatInterfaceControllerState
  onDiffPanelExpandedFilePathsChange: (nextFilePaths: string[]) => void
  onDiffPanelSelectedScopeChange: (nextScope: DiffPanelScope) => void
  onOpenSettings: () => void
  onSidebarWidthChange: (sidebarWidth: number) => void
  onUpdateSettings: (settings: Partial<AppSettings>) => void
  onCreateWorkspaceFolderFromPath: (folderPath: string) => Promise<void>
  resolvedTheme: ResolvedTheme
  sendMessageOnEnter: boolean
  settings: AppSettings
  sidebarWidth: number
  workspaceState: ChatWorkspaceUiState
  codexUsage: CodexUsageSnapshot | null | undefined
}

export function ChatInterfaceContent({
  chatMessages,
  chatRuntimeConfig,
  diffPanelExpandedFilePaths,
  diffPanelSelectedScope,
  gitBranchState,
  gitCommitState,
  gitDiffSnapshot,
  interfaceController,
  onDiffPanelExpandedFilePathsChange,
  onDiffPanelSelectedScopeChange,
  onCreateWorkspaceFolderFromPath,
  onOpenSettings,
  onSidebarWidthChange,
  onUpdateSettings,
  resolvedTheme,
  sendMessageOnEnter,
  settings,
  sidebarWidth,
  codexUsage,
  workspaceState,
}: ChatInterfaceContentProps) {
  const [selectedProjectId, setSelectedProjectId] = useState<string>(settings.selectedProjectId ?? ALL_PROJECTS_FILTER_ID)

  // Sync selectedProjectId with settings
  useEffect(() => {
    if (settings.selectedProjectId && settings.selectedProjectId !== selectedProjectId) {
      setSelectedProjectId(settings.selectedProjectId)
    }
  }, [settings.selectedProjectId, selectedProjectId])

  const activeWorkspacePath = chatMessages.activeConversationRootPath ?? chatMessages.selectedFolderPath
  const gitAddedLineCount = gitCommitState.status?.addedLineCount ?? 0
  const gitRemovedLineCount = gitCommitState.status?.removedLineCount ?? 0
  const runtimeSelection = useMemo(
    () => buildRuntimeSelection(chatRuntimeConfig, settings.contextCompaction, settings.terminalExecutionMode),
    [chatRuntimeConfig, settings.contextCompaction, settings.terminalExecutionMode],
  )
  const compressionSelection = useMemo(
    () => {
      const resolvedSelection = resolveTaskModelSelection({
        defaultSelection: runtimeSelection,
        modelOptions: chatRuntimeConfig.modelOptions,
        taskModelId: settings.summarizationModelId,
        taskModelProviderId: settings.summarizationModelProviderId,
      })

      return {
        ...resolvedSelection,
        reasoningEffort: runtimeSelection.reasoningEffort,
      }
    },
    [
      chatRuntimeConfig.modelOptions,
      runtimeSelection,
      settings.summarizationModelId,
      settings.summarizationModelProviderId,
    ],
  )
  const [compactionRefreshSignal, setCompactionRefreshSignal] = useState(0)
  const handleCompactionComplete = useCallback(() => {
    setCompactionRefreshSignal((current) => current + 1)
  }, [])
  const contextUsage = useChatContextUsage({
    agentContextRootPath: activeWorkspacePath,
    chatMode: chatMessages.selectedChatMode,
    conversationId: chatMessages.activeConversationId,
    contextCompaction: runtimeSelection.contextCompaction,
    messages: chatMessages.messages,
    modelId: runtimeSelection.modelId,
    providerId: runtimeSelection.providerId,
    refreshSignal: compactionRefreshSignal,
    terminalExecutionMode: runtimeSelection.terminalExecutionMode,
  })
  const compactionMarkers = useChatCompactionMarkers({
    conversationId: chatMessages.activeConversationId,
    messagesLength: chatMessages.messages.length,
    refreshSignal: compactionRefreshSignal,
  })
  const { candidates: refactorCandidates, isLoading: refactorCandidatesLoading } =
    useWorkspaceRefactorCandidates(activeWorkspacePath)
  const streamingAssistantMessage = useMemo(
    () =>
      chatMessages.streamingAssistantMessageId
        ? chatMessages.messages.find(
            (message) =>
              message.id === chatMessages.streamingAssistantMessageId && message.role === 'assistant',
          ) ?? null
        : null,
    [chatMessages.messages, chatMessages.streamingAssistantMessageId],
  )
  const activeStreamToolInvocations = streamingAssistantMessage?.toolInvocations ?? []
  const [isCompressingChat, setIsCompressingChat] = useState(false)
  const [workspaceViewMode, setWorkspaceViewMode] = useState<ChatWorkspaceViewMode>('chat')
  const isKanbanBoardOpen = workspaceViewMode === 'kanban'
  const isWorkspaceHeaderControlDisabled = isKanbanBoardOpen
  const handleToggleWorkspaceBoard = useCallback(() => {
    if (isKanbanBoardOpen) {
      setWorkspaceViewMode('chat')
      return
    }

    if (workspaceState.isExplorerOpen) {
      workspaceState.handleToggleExplorerPanel()
    }

    if (interfaceController.isDiffPanelOpen) {
      workspaceState.handleOpenDiffPanel()
    } else if (interfaceController.isSourceControlPanelOpen) {
      workspaceState.handleOpenSourceControlPanel()
    }

    if (workspaceState.isTerminalOpen) {
      workspaceState.handleTerminalOpenChange(false)
    }

    setWorkspaceViewMode('kanban')
  }, [
    interfaceController,
    isKanbanBoardOpen,
    workspaceState,
  ])

  const hasRunningToolInvocations = !canInterruptStreamForSteer(activeStreamToolInvocations)
  const successfulToolCompletionSignal = getLatestSuccessfulToolCompletionSignal(
    activeStreamToolInvocations,
  )
  const isQueueAutoSendBlocked = chatMessages.isLoading || isCompressingChat

  const sendQueuedMessage = useCallback(
    (
      queuedMessage: { content: string; attachments?: ChatAttachment[] },
      reason: QueuedMessageAutoSendReason,
    ) => {
      return (async () => {
        if (reason === 'successful_tool') {
          await chatMessages.abortStreamingResponse()
        }

        return chatMessages.sendNewMessage(runtimeSelection, queuedMessage.content, queuedMessage.attachments, {
          resetMainComposerAfterSend: false,
        })
      })()
    },
    [chatMessages, runtimeSelection],
  )

  const {
    clearQueuedMessages,
    enqueueMessage,
    queuedMessages,
    removeQueuedMessage,
    reorderQueuedMessages,
    updateQueuedMessage,
  } = useChatMessageQueue({
    followUpBehavior: settings.followUpBehavior,
    hasRunningToolInvocations,
    isAutoSendBlocked: isQueueAutoSendBlocked,
    isTurnActive: chatMessages.isSending,
    onSendMessage: sendQueuedMessage,
    successfulToolCompletionSignal,
  })
  const { handleCompressChat } = useChatCompression({
    activeConversationId: chatMessages.activeConversationId,
    activeWorkspacePath,
    chatMode: chatMessages.selectedChatMode,
    clearQueuedMessages,
    compressionSelection,
    isBusy: chatMessages.isLoading || chatMessages.isSending,
    isCompressingChat,
    messages: chatMessages.messages,
    onCompactionComplete: handleCompactionComplete,
    runtimeSelection,
    setError: chatMessages.setError,
    setIsCompressingChat,
  })
  const selectorOptions = useMemo(
    () =>
      chatRuntimeConfig.modelOptions.map((option) => ({
        label: option.label,
        providerLabel: option.providerLabel,
        value: option.id,
      })),
    [chatRuntimeConfig.modelOptions],
  )
  const chatModeOptions = CHAT_MODE_OPTIONS
  const hasRepository = gitBranchState.branchState.hasRepository
  const hasWorkspacePath = Boolean(workspaceState.activeWorkspacePath?.trim())
  // Commit/Diff buttons require an actual git repo; Source Control panel only needs a workspace path
  const isWorkspaceRepoHeaderControlDisabled = isWorkspaceHeaderControlDisabled || !hasRepository
  const isSourceControlButtonDisabled = isWorkspaceHeaderControlDisabled || !hasWorkspacePath
  const messageListBoundaryRef = useRef<HTMLDivElement>(null)

  const {
    chatPanelMaxWidth,
    chatPanelMinWidth,
    chatPanelRef,
    chatPanelWidth,
    handleChatResizePointerDown,
  } = useResizableChatPanel()

  const {
    handleCreateConversation,
    handleCreateFolder,
    handleCreateWorkspaceConversation,
    handleCreateWorkspaceFolderFromPath,
    handleDeleteConversation,
    handleDeleteFolder,
    handlePinConversation,
    handleSelectConversation,
    handleSelectProject,
  } = useConversationNavigationActions({
    chatMessages,
    clearQueuedMessages,
    onCreateWorkspaceFolderFromPath,
    onUpdateSettings,
    selectedProjectId,
    setSelectedProjectId,
    setWorkspaceViewMode,
  })

  const {
    handleCancelEditingMessage,
    handleEditUserMessage,
    handleImplementPlan,
    handleRevertUserMessage,
    handleSendEditedMessage,
    handleSendMainMessage,
    handleToolDecisionSubmit,
    showImplementPlanButton,
  } = useChatMessageActions({
    chatMessages,
    chatModeOptions,
    clearQueuedMessages,
    enqueueMessage,
    isCompressingChat,
    runtimeSelection,
    workspaceState,
  })

  const showQueueBlock =
    queuedMessages.length > 0 &&
    typeof removeQueuedMessage === 'function' &&
    typeof updateQueuedMessage === 'function' &&
    typeof reorderQueuedMessages === 'function'

  return (
    <AppWorkspaceShell
      isSidebarOpen={interfaceController.isSidebarOpen}
      onSidebarWidthChange={onSidebarWidthChange}
      floatingControls={
        <WorkspaceFloatingControls
          isSidebarOpen={interfaceController.isSidebarOpen}
          onToggleSidebar={interfaceController.handleToggleSidebar}
          newThreadButton={{
            onClick: handleCreateWorkspaceConversation,
          }}
        />
      }
      sidebar={
        <SidebarPanel
          conversationGroups={chatMessages.conversationGroups}
          isLoading={chatMessages.isLoading}
          onCreateFolder={handleCreateFolder}
          onCreateConversation={handleCreateConversation}
          onCreateWorkspaceFolderFromPath={handleCreateWorkspaceFolderFromPath}
          onDeleteConversation={handleDeleteConversation}
          onPinConversation={handlePinConversation}
          onDeleteFolder={handleDeleteFolder}
          onOpenSettings={onOpenSettings}
          onRenameFolder={chatMessages.renameFolder}
          onSelectConversation={handleSelectConversation}
          selectedProjectId={selectedProjectId}
          onSelectProject={handleSelectProject}
        />
      }
      sidebarWidth={sidebarWidth}
    >
      <WorkspacePanel isSidebarOpen={interfaceController.isSidebarOpen} showRightBorder={false}>
        <ChatHeader
          title={chatMessages.activeConversationTitle}
          isSidebarOpen={interfaceController.isSidebarOpen}
          trailingContent={
            <ChatWorkspaceHeaderControls
              addedLineCount={gitAddedLineCount}
              hasRepository={hasRepository}
              isDiffPanelOpen={interfaceController.isDiffPanelOpen}
              isExplorerOpen={workspaceState.isExplorerOpen}
              isKanbanBoardOpen={isKanbanBoardOpen}
              isSourceControlPanelOpen={interfaceController.isSourceControlPanelOpen}
              isSourceControlButtonDisabled={isSourceControlButtonDisabled}
              isTerminalOpen={workspaceState.isTerminalOpen}
              isWorkspaceHeaderControlDisabled={isWorkspaceHeaderControlDisabled}
              isWorkspaceRepoHeaderControlDisabled={isWorkspaceRepoHeaderControlDisabled}
              onOpenCommitModal={interfaceController.handleOpenCommitModal}
              onOpenDiffPanel={workspaceState.handleOpenDiffPanel}
              onOpenSourceControlPanel={workspaceState.handleOpenSourceControlPanel}
              onToggleExplorerPanel={workspaceState.handleToggleExplorerPanel}
              onToggleTerminalPanel={() => workspaceState.handleTerminalOpenChange(!workspaceState.isTerminalOpen)}
              onToggleWorkspaceBoard={handleToggleWorkspaceBoard}
              removedLineCount={gitRemovedLineCount}
            />
          }
          onRenameTitle={(nextTitle) => {
            if (!chatMessages.activeConversationId) {
              return
            }

            return chatMessages.renameConversationTitle(chatMessages.activeConversationId, nextTitle)
          }}
        />

        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          {/* Chat panel — fixed width when file editor is open, flex-1 when alone */}
          <div
            ref={chatPanelRef}
            className={[
              'relative flex min-h-0 flex-col overflow-hidden',
              workspaceState.isWorkspaceTabsPanelOpen ? 'shrink-0' : 'flex-1',
            ].join(' ')}
            style={
              workspaceState.isWorkspaceTabsPanelOpen
                ? { width: `${chatPanelWidth}px`, minWidth: `${chatPanelMinWidth}px`, maxWidth: `${chatPanelMaxWidth}px` }
                : undefined
            }
          >
            {/* Chat resize handle — only shown when file editor is open */}
            {workspaceState.isWorkspaceTabsPanelOpen ? (
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize chat panel"
                onPointerDown={handleChatResizePointerDown}
                className="absolute inset-y-0 right-0 z-30 w-2 translate-x-1/2 cursor-col-resize"
              />
            ) : null}
            <ChatConversationSurface
              activeWorkspacePath={activeWorkspacePath}
              chatMessages={chatMessages}
              chatModeOptions={chatModeOptions}
              chatRuntimeConfig={chatRuntimeConfig}
              codexUsage={codexUsage}
              compactionMarkers={compactionMarkers}
              contextUsage={contextUsage}
              gitBranchState={gitBranchState}
              handleCancelEditingMessage={handleCancelEditingMessage}
              handleCompressChat={handleCompressChat}
              handleEditUserMessage={handleEditUserMessage}
              handleImplementPlan={handleImplementPlan}
              handleRevertUserMessage={handleRevertUserMessage}
              handleSendEditedMessage={handleSendEditedMessage}
              handleSendMainMessage={handleSendMainMessage}
              handleToolDecisionSubmit={handleToolDecisionSubmit}
              isCompressingChat={isCompressingChat}
              isKanbanBoardOpen={isKanbanBoardOpen}
              messageListBoundaryRef={messageListBoundaryRef}
              onQueueMessage={enqueueMessage}
              onTerminalExecutionModeChange={interfaceController.handleTerminalExecutionModeChange}
              queuedMessages={queuedMessages}
              refactorCandidates={refactorCandidates}
              refactorCandidatesLoading={refactorCandidatesLoading}
              removeQueuedMessage={removeQueuedMessage}
              reorderQueuedMessages={reorderQueuedMessages}
              selectorOptions={selectorOptions}
              sendMessageOnEnter={sendMessageOnEnter}
              showImplementPlanButton={showImplementPlanButton}
              showQueueBlock={showQueueBlock}
              terminalExecutionMode={settings.terminalExecutionMode}
              updateQueuedMessage={updateQueuedMessage}
              workspaceState={workspaceState}
            />
            <WorkspaceTerminalPanel
              isOpen={workspaceState.isTerminalOpen}
              onClose={() => workspaceState.handleTerminalOpenChange(false)}
              onHeightCommit={interfaceController.handleTerminalPanelHeightCommit}
              resolvedTheme={resolvedTheme}
              storedHeight={workspaceState.terminalPanelHeight}
              workspaceKey={workspaceState.activeTerminalWorkspaceKey}
              workspacePath={workspaceState.activeWorkspacePath}
              isFullScreen={workspaceState.isTerminalFullScreen}
              onFullScreenChange={workspaceState.handleTerminalFullScreenChange}
            />
          </div>
          <ChatWorkspaceSidePanels
            diffPanelExpandedFilePaths={diffPanelExpandedFilePaths}
            diffPanelSelectedScope={diffPanelSelectedScope}
            gitBranchState={gitBranchState}
            gitDiffSnapshot={gitDiffSnapshot}
            interfaceController={interfaceController}
            onDiffPanelExpandedFilePathsChange={onDiffPanelExpandedFilePathsChange}
            onDiffPanelSelectedScopeChange={onDiffPanelSelectedScopeChange}
            settings={settings}
            workspaceState={workspaceState}
          />

        </div>
      </WorkspacePanel>

      {interfaceController.isCommitModalOpen ? (
        <CommitModal
          branchState={gitBranchState.branchState}
          diffSnapshot={gitDiffSnapshot.snapshot}
          errorMessage={gitCommitState.errorMessage}
          isCommitting={gitCommitState.isCommitting}
          isLoadingStatus={gitCommitState.isLoadingStatus}
          isSwitchingBranch={gitBranchState.isSwitching}
          onBranchChange={gitBranchState.changeBranch}
          onBranchCreate={gitBranchState.createBranch}
          onClose={interfaceController.handleCloseCommitModal}
          onCommit={interfaceController.handleCommit}
          status={gitCommitState.status}
        />
      ) : null}
      {interfaceController.commitSuccessDialog ? (
        <CommitSuccessDialog
          action={interfaceController.commitSuccessDialog.action}
          result={interfaceController.commitSuccessDialog.result}
          onClose={interfaceController.handleCloseCommitSuccessDialog}
        />
      ) : null}
    </AppWorkspaceShell>
  )
}
