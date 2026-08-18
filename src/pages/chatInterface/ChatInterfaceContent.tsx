import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChatHeader } from '../../components/ChatHeader'
import { CommitModal } from '../../components/commit/CommitModal'
import { CommitSuccessDialog } from '../../components/commit/CommitSuccessDialog'
import type { DiffPanelScope } from '../../components/chat/ConversationDiffPanel'
import { AppWorkspaceShell } from '../../components/layout/AppWorkspaceShell'
import { WorkspaceFloatingControls } from '../../components/layout/WorkspaceFloatingControls'
import { WorkspacePanel } from '../../components/layout/WorkspacePanel'
import { SidebarPanel } from '../../components/sidebar/SidebarPanel'
import { ALL_PROJECTS_FILTER_ID, ARCHIVED_PROJECT_FILTER_ID, CHATS_PROJECT_FILTER_ID } from '../../components/sidebar/sidebarProjectThreads'
import { WorkspaceTerminalPanel } from '../../components/chat/WorkspaceTerminalPanel'
import { useChatContextUsage } from '../../hooks/useChatContextUsage'
import { useChatCompactionMarkers } from '../../hooks/useChatCompactionMarkers'
import { useChatCompactionStatus } from '../../hooks/useChatCompactionStatus'
import type { ChatMessagesController } from '../../hooks/useChatMessages'
import type { ChatRuntimeConfigState } from '../../hooks/useChatRuntimeConfig'
import type { ChatInterfaceControllerState } from '../../hooks/useChatInterfaceController'
import type { GitBranchStateController } from '../../hooks/useGitBranchState'
import type { GitCommitController } from '../../hooks/useGitCommit'
import type { GitDiffSnapshotController } from '../../hooks/useGitDiffSnapshot'
import { useWorkspaceRefactorCandidates } from '../../hooks/useWorkspaceRefactorCandidates'
import { useIsMobileViewport } from '../../hooks/useIsMobileViewport'
import { useChatMessageQueue } from './useChatMessageQueue'
import { createQueuedComposerMessage } from './chatComposerQueue'
import type { QueuedMessageAutoSendReason } from './chatQueueAutoSend'
import { useChatCompression } from './useChatCompression'
import type { ChatWorkspaceUiState } from './useChatWorkspaceUiState'
import type { AppSettings, ChatAttachment, CodexUsageSnapshot, QueuedMessage, SharedFollowUpItem } from '../../types/chat'
import {
  EMPTY_CHAT_COMPACTION_GATE_STATE,
  hasMinimumCompactionMessages,
  isChatCompactionBlocked,
  reduceChatCompactionGate,
} from '../../lib/chatCompactionGate'
import type { ResolvedTheme } from '../../lib/theme'
import { resolveProjectFilterDraftFolderId } from '../../lib/projectSelectionUtils'
import { resolveTaskModelSelection } from '../../lib/taskModelSelection'
import { resolveFollowUpBehaviorForAction } from '../../lib/appSettings'
import { ChatWorkspaceHeaderControls } from './ChatWorkspaceHeaderControls'
import { ChatWorkspaceSidePanels } from './ChatWorkspaceSidePanels'
import { useResizableChatPanel } from './useResizableChatPanel'
import { ChatConversationSurface } from './ChatConversationSurface'
import { useChatMessageActions } from './useChatMessageActions'
import { useConversationNavigationActions } from './useConversationNavigationActions'
import { buildRuntimeSelection, CHAT_MODE_OPTIONS } from './chatInterfaceRuntime'
import type { SettingsItemId } from '../../components/settings/settingsItems'
import { MobileWorkspaceNavigation, type MobileWorkspaceSurface } from './MobileWorkspaceNavigation'

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
  onOpenSettings: (itemId?: SettingsItemId) => void
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
  const previousActiveConversationArchivedRef = useRef<boolean | null>(null)

  // Sync selectedProjectId with settings
  useEffect(() => {
    if (settings.selectedProjectId && settings.selectedProjectId !== selectedProjectId) {
      setSelectedProjectId(settings.selectedProjectId)
    }
  }, [settings.selectedProjectId, selectedProjectId])

  const activeConversationIsArchived = useMemo(() => {
    const activeConversationId = chatMessages.activeConversationId
    if (!activeConversationId) {
      return false
    }

    return chatMessages.conversationGroups.some((group) =>
      group.conversations.some(
        (conversation) => conversation.id === activeConversationId && conversation.isArchived === true,
      ),
    )
  }, [chatMessages.activeConversationId, chatMessages.conversationGroups])

  useEffect(() => {
    const previousValue = previousActiveConversationArchivedRef.current
    previousActiveConversationArchivedRef.current = activeConversationIsArchived

    if (
      selectedProjectId === ARCHIVED_PROJECT_FILTER_ID &&
      previousValue === true &&
      activeConversationIsArchived === false
    ) {
      setSelectedProjectId(ALL_PROJECTS_FILTER_ID)
      onUpdateSettings({ selectedProjectId: ALL_PROJECTS_FILTER_ID, selectedProjectName: null })
    }
  }, [activeConversationIsArchived, onUpdateSettings, selectedProjectId])

  useEffect(() => {
    if (chatMessages.isLoading) return
    if (
      selectedProjectId === ALL_PROJECTS_FILTER_ID ||
      selectedProjectId === ARCHIVED_PROJECT_FILTER_ID
    ) {
      return
    }

    const selectedProjectName = chatMessages.conversationGroups.find(
      (group) => group.folder.id === selectedProjectId,
    )?.folder.name
    if (selectedProjectName && selectedProjectName !== settings.selectedProjectName) {
      onUpdateSettings({ selectedProjectName })
    }
  }, [
    chatMessages.conversationGroups,
    chatMessages.isLoading,
    onUpdateSettings,
    selectedProjectId,
    settings.selectedProjectName,
  ])

  const synchronizeDraftFolder = chatMessages.synchronizeDraftFolder

  useEffect(() => {
    if (chatMessages.isLoading || chatMessages.activeConversationId !== null) {
      return
    }

    const targetDraftFolderId = resolveProjectFilterDraftFolderId(selectedProjectId)
    if (targetDraftFolderId === undefined || targetDraftFolderId === chatMessages.selectedFolderId) {
      return
    }

synchronizeDraftFolder(targetDraftFolderId)
  }, [
    chatMessages.activeConversationId,
    chatMessages.isLoading,
    chatMessages.selectedFolderId,
synchronizeDraftFolder,
    selectedProjectId,
  ])

  const emptyStateFolderName = useMemo(() => {
    if (selectedProjectId === CHATS_PROJECT_FILTER_ID) {
      return 'Chats'
    }

    const targetDraftFolderId = resolveProjectFilterDraftFolderId(selectedProjectId)
    if (typeof targetDraftFolderId !== 'string') {
      return chatMessages.selectedFolderName
    }

    const loadedProjectName = chatMessages.conversationGroups.find(
      (group) => group.folder.id === targetDraftFolderId,
    )?.folder.name
    if (loadedProjectName) {
      return loadedProjectName
    }

    if (settings.selectedProjectId === selectedProjectId) {
      return settings.selectedProjectName?.trim() || 'Project'
    }

    return 'Project'
  }, [
    chatMessages.conversationGroups,
    chatMessages.selectedFolderName,
    selectedProjectId,
    settings.selectedProjectId,
    settings.selectedProjectName,
  ])

  const activeWorkspacePath = chatMessages.activeConversationRootPath ?? chatMessages.selectedFolderPath
  const gitAddedLineCount = gitCommitState.status?.hasRepository ? gitCommitState.status.addedLineCount : null
  const gitRemovedLineCount = gitCommitState.status?.hasRepository ? gitCommitState.status.removedLineCount : null
  const runtimeSelection = useMemo(
    () => buildRuntimeSelection(
      chatRuntimeConfig,
      settings.contextCompaction,
      settings.terminalExecutionMode,
    ),
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
  const [chatCompactionGateState, setChatCompactionGateState] = useState(EMPTY_CHAT_COMPACTION_GATE_STATE)
  const handleCompactionComplete = useCallback(() => {
    const conversationId = chatMessages.activeConversationId
    if (!conversationId) {
      return
    }

    setCompactionRefreshSignal((current) => current + 1)
    setChatCompactionGateState((currentState) => reduceChatCompactionGate(currentState, {
      conversationId,
      type: 'compaction_committed',
    }))
  }, [chatMessages.activeConversationId])
  const handleConversationHistoryChanged = useCallback(() => {
    setCompactionRefreshSignal((current) => current + 1)
  }, [])
  const handleMainTurnAccepted = useCallback(() => {
    const conversationId = chatMessages.activeConversationId
    if (!conversationId) {
      return
    }

    setChatCompactionGateState((currentState) => reduceChatCompactionGate(currentState, {
      conversationId,
      type: 'real_turn_accepted',
    }))
  }, [chatMessages.activeConversationId])
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
    refreshSignal: compactionRefreshSignal,
  })
  const hasCompactionMessageMinimum = hasMinimumCompactionMessages(
    chatMessages.messages,
    compactionMarkers,
  )
  const isChatFreshlyCompacted = isChatCompactionBlocked(
    chatCompactionGateState,
    chatMessages.activeConversationId,
  )
  const isCompactionUnavailable = isChatFreshlyCompacted || !hasCompactionMessageMinimum
  const liveCompaction = useChatCompactionStatus({
    conversationId: chatMessages.activeConversationId,
  })
  const { candidates: refactorCandidates, isLoading: refactorCandidatesLoading } =
    useWorkspaceRefactorCandidates(activeWorkspacePath)
  const [isCompressingChat, setIsCompressingChat] = useState(false)
  const isMobileViewport = useIsMobileViewport()
  const [workspaceViewMode, setWorkspaceViewMode] = useState<ChatWorkspaceViewMode>('chat')
  const [mobileSurface, setMobileSurface] = useState<MobileWorkspaceSurface>('chat')
  const isKanbanBoardOpen = isMobileViewport ? mobileSurface === 'board' : workspaceViewMode === 'kanban'
  const isMobileTerminalOpen = isMobileViewport && mobileSurface === 'terminal'
  const isTerminalSurfaceOpen = isMobileTerminalOpen || (
    !isMobileViewport && workspaceState.isTerminalOpen && workspaceState.isTerminalFullScreen
  )
  const isWorkspaceHeaderControlDisabled = isKanbanBoardOpen
  const setIsSidebarOpen = interfaceController.setIsSidebarOpen

  useEffect(() => {
    if (!isMobileViewport) return
    setIsSidebarOpen(false)
    setMobileSurface('chat')
  }, [isMobileViewport, setIsSidebarOpen])
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

  const isQueueAutoSendBlocked =
    chatMessages.isAbortInProgress ||
    chatMessages.isLoading ||
    isCompressingChat ||
    !chatRuntimeConfig.hasConfiguredProvider ||
    !chatRuntimeConfig.providerId ||
    chatRuntimeConfig.selectedRuntimeModelId.trim().length === 0

  const sendQueuedMessage = useCallback(
    async (
      queuedMessages: readonly QueuedMessage[],
      reason: QueuedMessageAutoSendReason,
    ) => {
      void reason
      const result = await chatMessages.sendNewMessages(runtimeSelection, queuedMessages, {
        resetMainComposerAfterSend: false,
        waitForConversationToSettle: true,
      })
      if (result.accepted) {
        handleMainTurnAccepted()
      }

      return result
    },
    [chatMessages, handleMainTurnAccepted, runtimeSelection],
  )

  const {
    clearQueuedMessages,
    enqueueMessage,
    queuedMessages,
    removeQueuedMessage,
    reorderQueuedMessages,
    updateQueuedMessage,
  } = useChatMessageQueue({
    activeStreamId: chatMessages.activeStreamId,
    followUpBehavior: settings.followUpBehavior,
    isAutoSendBlocked: isQueueAutoSendBlocked,
    isTurnActive: chatMessages.isSending,
    onSendMessage: sendQueuedMessage,
  })
  const pendingAlternateFollowUpsRef = useRef<SharedFollowUpItem[]>([])
  const publishAlternateFollowUp = useCallback((streamId: string, item: SharedFollowUpItem) => {
    void window.tidecodeRuns.updatePendingFollowUps({
      mutation: { type: 'add', item },
      streamId,
    }).catch((error) => {
      console.error('Unable to add alternate shared follow-up message.', error)
      pendingAlternateFollowUpsRef.current.push(item)
    })
  }, [])
  const enqueueAlternateFollowUpMessage = useCallback((value: string, attachments: ChatAttachment[]) => {
    const item: SharedFollowUpItem = {
      behavior: resolveFollowUpBehaviorForAction('alternate', settings.followUpBehavior),
      message: createQueuedComposerMessage({ attachments, content: value }),
    }
    const streamId = chatMessages.activeStreamId
    if (streamId) {
      publishAlternateFollowUp(streamId, item)
      return
    }
    pendingAlternateFollowUpsRef.current.push(item)
  }, [chatMessages.activeStreamId, publishAlternateFollowUp, settings.followUpBehavior])

  useEffect(() => {
    const streamId = chatMessages.activeStreamId
    if (!streamId || pendingAlternateFollowUpsRef.current.length === 0) return
    const pendingItems = pendingAlternateFollowUpsRef.current.splice(0)
    for (const item of pendingItems) publishAlternateFollowUp(streamId, item)
  }, [chatMessages.activeStreamId, publishAlternateFollowUp])

  useEffect(() => {
    if (chatMessages.activeStreamId || chatMessages.isSending || chatMessages.isStreamingResponse) return
    if (pendingAlternateFollowUpsRef.current.length === 0) return
    const pendingItems = pendingAlternateFollowUpsRef.current.splice(0)
    for (const item of pendingItems) {
      enqueueMessage(item.message.content, item.message.attachments ?? [])
    }
  }, [chatMessages.activeStreamId, chatMessages.isSending, chatMessages.isStreamingResponse, enqueueMessage])

  const { handleCompressChat } = useChatCompression({
    activeConversationId: chatMessages.activeConversationId,
    activeWorkspacePath,
    chatMode: chatMessages.selectedChatMode,
    compressionSelection,
    isBusy: chatMessages.isLoading || chatMessages.isSending,
    isCompactionUnavailable,
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
     handleArchiveConversation,
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
    handleRequestPlanChanges,
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
    onMainTurnAccepted: handleMainTurnAccepted,
    onConversationHistoryChanged: handleConversationHistoryChanged,
    runtimeSelection,
    workspaceState,
  })

  const handleMobileSurfaceChange = useCallback((surface: MobileWorkspaceSurface) => {
    setMobileSurface(surface)
    setIsSidebarOpen(false)
  }, [setIsSidebarOpen])

  const handleSidebarConversationSelect = useCallback((conversationId: string) => {
    handleSelectConversation(conversationId)
    if (!isMobileViewport) return
    setMobileSurface('chat')
    setIsSidebarOpen(false)
  }, [handleSelectConversation, isMobileViewport, setIsSidebarOpen])

  const handleSidebarCreateConversation = useCallback((folderId?: string | null) => {
    void handleCreateConversation(folderId)
    if (!isMobileViewport) return
    setMobileSurface('chat')
    setIsSidebarOpen(false)
  }, [handleCreateConversation, isMobileViewport, setIsSidebarOpen])

  const handleSidebarOpenSettings = useCallback((itemId?: SettingsItemId) => {
    if (isMobileViewport) setIsSidebarOpen(false)
    onOpenSettings(itemId)
  }, [isMobileViewport, onOpenSettings, setIsSidebarOpen])

  const isDesktopWorkspaceTabsPanelOpen = !isMobileViewport && workspaceState.isWorkspaceTabsPanelOpen

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
        !isMobileViewport || mobileSurface === 'chat' ? (
          <WorkspaceFloatingControls
            isSidebarOpen={interfaceController.isSidebarOpen}
            onToggleSidebar={interfaceController.handleToggleSidebar}
            newThreadButton={{
              onClick: handleCreateWorkspaceConversation,
            }}
          />
        ) : null
      }
      sidebar={
        <SidebarPanel
          conversationGroups={chatMessages.conversationGroups}
          isLoading={chatMessages.isLoading}
          onCreateFolder={handleCreateFolder}
          onCreateConversation={handleSidebarCreateConversation}
          onCreateWorkspaceFolderFromPath={handleCreateWorkspaceFolderFromPath}
          onArchiveConversation={handleArchiveConversation}
          onDeleteConversation={handleDeleteConversation}
          onPinConversation={handlePinConversation}
          onDeleteFolder={handleDeleteFolder}
          onOpenSettings={handleSidebarOpenSettings}
          onRenameFolder={async (folderId, name) => {
            await chatMessages.renameFolder(folderId, name)
            if (folderId === selectedProjectId) {
              onUpdateSettings({ selectedProjectName: name.trim() || settings.selectedProjectName })
            }
          }}
          onSelectConversation={handleSidebarConversationSelect}
          selectedProjectId={selectedProjectId}
          selectedProjectName={settings.selectedProjectName}
          onSelectProject={handleSelectProject}
        />
      }
      sidebarWidth={sidebarWidth}
    >
      <WorkspacePanel isSidebarOpen={interfaceController.isSidebarOpen} showRightBorder={false}>
        {!isMobileViewport || mobileSurface === 'chat' ? (
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
        ) : null}

        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          {/* Chat panel — fixed width when file editor is open, flex-1 when alone */}
          <div
            ref={chatPanelRef}
            className={[
              'relative flex min-h-0 flex-col overflow-hidden',
              isDesktopWorkspaceTabsPanelOpen ? 'shrink-0' : 'flex-1',
            ].join(' ')}
            style={
              isDesktopWorkspaceTabsPanelOpen
                ? { width: `${chatPanelWidth}px`, minWidth: `${chatPanelMinWidth}px`, maxWidth: `${chatPanelMaxWidth}px` }
                : undefined
            }
          >
            {/* Chat resize handle — only shown when file editor is open */}
            {isDesktopWorkspaceTabsPanelOpen ? (
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
              compactDisabled={isCompactionUnavailable}
              compactionMarkers={compactionMarkers}
              liveCompaction={liveCompaction}
              contextUsage={contextUsage}
              gitBranchState={gitBranchState}
              emptyStateFolderName={emptyStateFolderName}
              followUpBehavior={settings.followUpBehavior}
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
              isTerminalSurfaceOpen={isTerminalSurfaceOpen}
              messageListBoundaryRef={messageListBoundaryRef}
              onQueueMessage={enqueueMessage}
              onAlternateFollowUpMessage={enqueueAlternateFollowUpMessage}
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
              isOpen={isMobileViewport ? isMobileTerminalOpen : workspaceState.isTerminalOpen}
              onClose={() => {
                if (isMobileViewport) {
                  setMobileSurface('chat')
                  return
                }
                workspaceState.handleTerminalOpenChange(false)
              }}
              onHeightCommit={interfaceController.handleTerminalPanelHeightCommit}
              resolvedTheme={resolvedTheme}
              storedHeight={workspaceState.terminalPanelHeight}
              workspaceKey={workspaceState.activeTerminalWorkspaceKey}
              workspacePath={workspaceState.activeWorkspacePath}
              isFullScreen={isMobileViewport ? true : workspaceState.isTerminalFullScreen}
              onFullScreenChange={isMobileViewport ? undefined : workspaceState.handleTerminalFullScreenChange}
            />
          </div>
          {!isMobileViewport ? (
            <ChatWorkspaceSidePanels
              diffPanelExpandedFilePaths={diffPanelExpandedFilePaths}
              diffPanelSelectedScope={diffPanelSelectedScope}
              gitBranchState={gitBranchState}
              gitDiffSnapshot={gitDiffSnapshot}
              interfaceController={interfaceController}
              onDiffPanelExpandedFilePathsChange={onDiffPanelExpandedFilePathsChange}
              onDiffPanelSelectedScopeChange={onDiffPanelSelectedScopeChange}
              onImplementPlan={handleImplementPlan}
              onRequestPlanChanges={handleRequestPlanChanges}
              settings={settings}
              workspaceState={workspaceState}
            />
          ) : null}

        </div>
        {isMobileViewport ? (
          <MobileWorkspaceNavigation activeSurface={mobileSurface} onSurfaceChange={handleMobileSurfaceChange} />
        ) : null}
      </WorkspacePanel>

      {interfaceController.isCommitModalOpen ? (
        <CommitModal
          branchState={gitBranchState.branchState}
          diffSnapshot={gitDiffSnapshot.snapshot}
          errorMessage={gitCommitState.errorMessage}
          isCommitting={gitCommitState.isCommitting}
          isSwitchingBranch={gitBranchState.isSwitching}
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
