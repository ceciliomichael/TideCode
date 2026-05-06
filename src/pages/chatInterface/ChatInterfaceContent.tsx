import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Columns3, FolderTree, GitBranch, GitCommitHorizontal, GitCompareArrows, Terminal } from 'lucide-react'
import { ChatHeader } from '../../components/ChatHeader'
import { MessageList } from '../../components/MessageList'
import { ChatInput } from '../../components/ChatInput'
import { EmptyState } from '../../components/EmptyState'
import { CommitModal } from '../../components/commit/CommitModal'
import { CommitSuccessDialog } from '../../components/commit/CommitSuccessDialog'
import type { ChatModeOption } from '../../components/chat/ChatModeSelectorField'
import { ConversationDiffPanel, type DiffPanelScope } from '../../components/chat/ConversationDiffPanel'
import { ChatQueueBlock } from '../../components/chat/ChatQueueBlock'
import type { ToolDecisionSubmission } from '../../components/chat/ToolDecisionRequestCard'
import { KanbanBoard } from '../../components/kanban/KanbanBoard'
import { AppWorkspaceShell } from '../../components/layout/AppWorkspaceShell'
import { WorkspaceFloatingControls } from '../../components/layout/WorkspaceFloatingControls'
import { WorkspacePanel } from '../../components/layout/WorkspacePanel'
import { SidebarPanel } from '../../components/sidebar/SidebarPanel'
import { SourceControlPanel } from '../../components/sourceControl/SourceControlPanel'
import { WorkspaceTerminalPanel } from '../../components/chat/WorkspaceTerminalPanel'
import { Tooltip } from '../../components/Tooltip'
import { WorkspaceExplorerPanel } from '../../components/workspaceExplorer/WorkspaceExplorerPanel'
import { WorkspaceFileTabsPanel } from '../../components/workspaceExplorer/WorkspaceFileTabsPanel'
import { useChatContextUsage } from '../../hooks/useChatContextUsage'
import type { ChatMessagesController, ChatRuntimeSelection } from '../../hooks/useChatMessages'
import type { ChatRuntimeConfigState } from '../../hooks/useChatRuntimeConfig'
import type { ChatInterfaceControllerState } from '../../hooks/useChatInterfaceController'
import type { GitBranchStateController } from '../../hooks/useGitBranchState'
import type { GitCommitController } from '../../hooks/useGitCommit'
import type { GitDiffSnapshotController } from '../../hooks/useGitDiffSnapshot'
import { useWorkspaceRefactorCandidates } from '../../hooks/useWorkspaceRefactorCandidates'
import { useChatMessageQueue } from './useChatMessageQueue'
import { canInterruptStreamForSteer } from './chatSteerFollowUp'
import { useChatCompression } from './useChatCompression'
import type { ChatWorkspaceUiState } from './useChatWorkspaceUiState'
import type {
  AppSettings,
  ChatAttachment,
  CodexUsageSnapshot,
  ReorderConversationFolderInput,
  ToolInvocationTrace,
} from '../../types/chat'
import type { ResolvedTheme } from '../../lib/theme'
import { getNextChatMode, isChatModeToggleShortcut } from '../../components/chat/chatModeShortcut'
import { resolveTaskModelSelection } from '../../lib/taskModelSelection'

const CHAT_MODE_OPTIONS: readonly ChatModeOption[] = [
  {
    description: 'Echo can inspect and edit code',
    label: 'Agent',
    value: 'agent',
  },
  {
    description: 'Echo explores and plans with list/read/glob/grep + ask_question + ready_implement',
    label: 'Plan',
    value: 'plan',
  },
] as const

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
  resolvedTheme: ResolvedTheme
  sendMessageOnEnter: boolean
  settings: AppSettings
  sidebarWidth: number
  workspaceState: ChatWorkspaceUiState
  codexUsage: CodexUsageSnapshot | null | undefined
}

function buildRuntimeSelection(
  chatRuntimeConfig: ChatRuntimeConfigState,
  terminalExecutionMode: AppSettings['terminalExecutionMode'],
): ChatRuntimeSelection {
  return {
    hasConfiguredProvider: chatRuntimeConfig.hasConfiguredProvider,
    modelId: chatRuntimeConfig.selectedRuntimeModelId,
    providerId: chatRuntimeConfig.providerId,
    providerLabel: chatRuntimeConfig.providerLabel,
    reasoningEffort: chatRuntimeConfig.reasoningEffort,
    terminalExecutionMode,
  }
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
  onOpenSettings,
  onSidebarWidthChange,
  resolvedTheme,
  sendMessageOnEnter,
  settings,
  sidebarWidth,
  codexUsage,
  workspaceState,
}: ChatInterfaceContentProps) {
  const activeWorkspacePath = chatMessages.activeConversationRootPath ?? chatMessages.selectedFolderPath
  const runtimeSelection = useMemo(
    () => buildRuntimeSelection(chatRuntimeConfig, settings.terminalExecutionMode),
    [chatRuntimeConfig, settings.terminalExecutionMode],
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
  const contextUsage = useChatContextUsage({
    agentContextRootPath: activeWorkspacePath,
    chatMode: chatMessages.selectedChatMode,
    messages: chatMessages.messages,
    providerId: runtimeSelection.providerId,
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

  const canSteerQueuedMessages =
    settings.followUpBehavior === 'steer' &&
    chatMessages.isSending &&
    canInterruptStreamForSteer(activeStreamToolInvocations)
  const isQueueBlocked =
    chatMessages.isLoading ||
    isCompressingChat ||
    (settings.followUpBehavior === 'queue'
      ? chatMessages.isSending
      : chatMessages.isSending && !canSteerQueuedMessages)

  const sendQueuedMessage = useCallback(
    (queuedMessage: { content: string; attachments?: ChatAttachment[] }) => {
      return (async () => {
        if (canSteerQueuedMessages) {
          await chatMessages.abortStreamingResponse()
        }

        return chatMessages.sendNewMessage(runtimeSelection, queuedMessage.content, queuedMessage.attachments, {
          resetMainComposerAfterSend: false,
        })
      })()
    },
    [canSteerQueuedMessages, chatMessages, runtimeSelection],
  )

  const {
    clearQueuedMessages,
    enqueueMessage,
    forceSendQueuedMessage,
    queuedMessages,
    removeQueuedMessage,
    updateQueuedMessage,
  } = useChatMessageQueue({
    isQueueBlocked,
    onSendMessage: sendQueuedMessage,
  })
  const { handleCompressChat } = useChatCompression({
    activeWorkspacePath,
    chatMode: chatMessages.selectedChatMode,
    clearQueuedMessages,
    compressionSelection,
    createConversation: chatMessages.createConversation,
    isBusy: chatMessages.isLoading || chatMessages.isSending,
    isCompressingChat,
    messages: chatMessages.messages,
    runtimeSelection,
    sendProgrammaticMessage: chatMessages.sendProgrammaticMessage,
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
  const isWorkspaceRepoHeaderControlDisabled = isWorkspaceHeaderControlDisabled || !hasRepository
  const messageListBoundaryRef = useRef<HTMLDivElement>(null)

  const handleCreateConversation = useCallback(async (folderId?: string | null) => {
    clearQueuedMessages()
    setWorkspaceViewMode('chat')
    await chatMessages.createConversation(folderId)
  }, [chatMessages, clearQueuedMessages])

  const handleCreateWorkspaceConversation = useCallback(async () => {
    clearQueuedMessages()
    setWorkspaceViewMode('chat')
    await chatMessages.createConversation()
  }, [chatMessages, clearQueuedMessages])

  const handleSelectConversation = useCallback(
    (conversationId: string) => {
      clearQueuedMessages()
      setWorkspaceViewMode('chat')
      void chatMessages.selectConversation(conversationId)
    },
    [chatMessages, clearQueuedMessages],
  )

  const handleSelectFolder = useCallback(async (folderId: string | null) => {
    clearQueuedMessages()
    await chatMessages.selectFolder(folderId)
  }, [chatMessages, clearQueuedMessages])

  const handleCreateFolder = useCallback(async () => {
    clearQueuedMessages()
    await chatMessages.createFolder()
  }, [chatMessages, clearQueuedMessages])

  const handleDeleteConversation = useCallback(
    (conversationId: string) => {
      clearQueuedMessages()
      void chatMessages.deleteConversation(conversationId)
    },
    [chatMessages, clearQueuedMessages],
  )

  const handleDeleteFolder = useCallback(
    async (folderId: string) => {
      clearQueuedMessages()
      await chatMessages.deleteFolder(folderId)
    },
    [chatMessages, clearQueuedMessages],
  )

  const handleReorderFolder = useCallback(
    async (input: ReorderConversationFolderInput) => {
      clearQueuedMessages()
      await chatMessages.reorderFolder(input)
    },
    [chatMessages, clearQueuedMessages],
  )

  const handleRevertUserMessage = useCallback(
    async (messageId: string) => {
      clearQueuedMessages()
      await chatMessages.revertUserMessage(messageId)
      await workspaceState.handleRefreshWorkspaceFileTabs()
    },
    [chatMessages, clearQueuedMessages, workspaceState],
  )

  const handleEditUserMessage = useCallback(
    async (messageId: string) => {
      await chatMessages.startEditingMessage(messageId)
      await workspaceState.handleRefreshWorkspaceFileTabs()
    },
    [chatMessages, workspaceState],
  )

  const handleCancelEditingMessage = useCallback(async () => {
    await chatMessages.cancelEditingMessage()
    await workspaceState.handleRefreshWorkspaceFileTabs()
  }, [chatMessages, workspaceState])

  const handleSendMainMessage = useCallback(
    (value: string, attachments: ChatAttachment[]) => {
      if (chatMessages.isLoading || chatMessages.isSending || isCompressingChat) {
        enqueueMessage(value, attachments)
        return
      }

      void chatMessages.sendNewMessage(runtimeSelection, value, attachments)
    },
    [chatMessages, enqueueMessage, isCompressingChat, runtimeSelection],
  )

  const handleSendEditedMessage = useCallback(
    (value: string, attachments: ChatAttachment[]) => {
      void chatMessages.sendEditedMessage(runtimeSelection, value, attachments)
    },
    [chatMessages, runtimeSelection],
  )

  const isAiBusy = chatMessages.isLoading || chatMessages.isSending || chatMessages.isStreamingResponse || isCompressingChat
  const hasConversationMessages = chatMessages.messages.length > 0
  const showImplementPlanButton = chatMessages.selectedChatMode === 'plan' && hasConversationMessages && !isAiBusy

  const handleImplementPlan = useCallback(() => {
    if (isAiBusy || chatMessages.selectedChatMode !== 'plan') {
      return
    }

    chatMessages.setSelectedChatMode('agent')
    void chatMessages.sendProgrammaticMessage(runtimeSelection, 'Implement the plan', {
      chatMode: 'agent',
    })
  }, [chatMessages, isAiBusy, runtimeSelection])

  const showQueueBlock =
    queuedMessages.length > 0 &&
    typeof removeQueuedMessage === 'function' &&
    typeof updateQueuedMessage === 'function' &&
    typeof forceSendQueuedMessage === 'function'

  const handleToolDecisionSubmit = useCallback(
    (invocation: ToolInvocationTrace, submission: ToolDecisionSubmission) => {
      const decisionRequest = invocation.decisionRequest
      if (!decisionRequest) {
        return
      }

      if (invocation.toolName === 'ready_implement') {
        const nextMode =
          submission.selectedOptionId === 'yes_implement'
            ? 'agent'
            : submission.selectedOptionId === 'no_modify'
              ? 'plan'
              : chatMessages.selectedChatMode
        chatMessages.setSelectedChatMode(nextMode)
      }

      void window.echosphereChat
        .submitToolDecision({
          customAnswer: submission.customAnswer,
          invocationId: invocation.id,
          selectedOptionId: submission.selectedOptionId,
          streamId: decisionRequest.streamId,
        })
        .catch((error) => {
          console.error(error)
        })
    },
    [chatMessages],
  )

  const handleCycleChatMode = useCallback(() => {
    const nextChatMode = getNextChatMode(chatMessages.selectedChatMode, chatModeOptions)
    if (!nextChatMode) {
      return
    }

    chatMessages.setSelectedChatMode(nextChatMode)
  }, [chatMessages, chatModeOptions])

  useEffect(() => {
    function handleWindowKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) {
        return
      }

      const isImplementPlanShortcut = event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.code === 'KeyI'
      if (isImplementPlanShortcut) {
        event.preventDefault()
        handleImplementPlan()
        return
      }

      if (!isChatModeToggleShortcut(event)) {
        return
      }

      event.preventDefault()
      handleCycleChatMode()
    }

    window.addEventListener('keydown', handleWindowKeyDown)
    return () => window.removeEventListener('keydown', handleWindowKeyDown)
  }, [handleCycleChatMode, handleImplementPlan])

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
          onCreateFolder={handleCreateFolder}
          onCreateConversation={handleCreateConversation}
          onDeleteConversation={handleDeleteConversation}
          onDeleteFolder={handleDeleteFolder}
          onReorderFolder={handleReorderFolder}
          onOpenSettings={onOpenSettings}
          onRenameFolder={chatMessages.renameFolder}
          onSelectConversation={handleSelectConversation}
          onSelectFolder={handleSelectFolder}
        />
      }
      sidebarWidth={sidebarWidth}
    >
      <WorkspacePanel isSidebarOpen={interfaceController.isSidebarOpen} showRightBorder={false}>
        <ChatHeader
          title={chatMessages.activeConversationTitle}
          isSidebarOpen={interfaceController.isSidebarOpen}
          trailingContent={
            <div className="flex items-center gap-1">
              <Tooltip content={isKanbanBoardOpen ? 'Return to chat' : 'Open Kanban board'} side="bottom">
                <button
                  type="button"
                  aria-pressed={isKanbanBoardOpen}
                  onClick={() => setWorkspaceViewMode(isKanbanBoardOpen ? 'chat' : 'kanban')}
                  className={[
                    'inline-flex h-10 items-center gap-1.5 text-sm transition-colors',
                    isKanbanBoardOpen ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                  ].join(' ')}
                >
                  <Columns3 size={16} className="shrink-0" />
                  <span className="hidden md:inline">Board</span>
                </button>
              </Tooltip>
              <div className="mx-1 h-5 w-px bg-border" />
              {isWorkspaceHeaderControlDisabled ? (
                <button
                  type="button"
                  disabled={isWorkspaceHeaderControlDisabled}
                  onClick={() => interfaceController.setActiveWorkspaceTerminalOpen(!workspaceState.isTerminalOpen)}
                  className={[
                    'inline-flex h-10 items-center gap-1.5 text-sm transition-colors',
                    isWorkspaceHeaderControlDisabled
                      ? 'cursor-not-allowed opacity-50'
                      : workspaceState.isTerminalOpen
                        ? 'text-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                  ].join(' ')}
                >
                  <Terminal size={16} className="shrink-0" />
                  <span className="hidden md:inline">Terminal</span>
                </button>
              ) : (
                <Tooltip content={workspaceState.isTerminalOpen ? 'Hide terminal panel' : 'Open terminal panel'} side="bottom">
                  <button
                    type="button"
                    disabled={isWorkspaceHeaderControlDisabled}
                    onClick={() => interfaceController.setActiveWorkspaceTerminalOpen(!workspaceState.isTerminalOpen)}
                    className={[
                      'inline-flex h-10 items-center gap-1.5 text-sm transition-colors',
                      workspaceState.isTerminalOpen
                        ? 'text-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    ].join(' ')}
                  >
                    <Terminal size={16} className="shrink-0" />
                    <span className="hidden md:inline">Terminal</span>
                  </button>
                </Tooltip>
              )}
              <div className="mx-1 h-5 w-px bg-border" />
              {isWorkspaceRepoHeaderControlDisabled ? (
                <button
                  type="button"
                  disabled={isWorkspaceRepoHeaderControlDisabled}
                  onClick={interfaceController.handleOpenCommitModal}
                  className={[
                    'inline-flex h-10 items-center gap-1.5 text-sm text-muted-foreground transition-colors',
                    isWorkspaceRepoHeaderControlDisabled ? 'cursor-not-allowed opacity-50' : 'hover:text-foreground',
                  ].join(' ')}
                >
                  <GitCommitHorizontal size={16} className="shrink-0" />
                  <span className="hidden md:inline">Commit</span>
                </button>
              ) : (
                <Tooltip content={hasRepository ? 'Commit changes' : 'Open a git-backed folder to commit'} side="bottom">
                  <button
                    type="button"
                    disabled={isWorkspaceRepoHeaderControlDisabled}
                    onClick={interfaceController.handleOpenCommitModal}
                    className={[
                      'inline-flex h-10 items-center gap-1.5 text-sm text-muted-foreground transition-colors',
                      isWorkspaceRepoHeaderControlDisabled ? 'cursor-not-allowed opacity-50' : 'hover:text-foreground',
                    ].join(' ')}
                  >
                    <GitCommitHorizontal size={16} className="shrink-0" />
                    <span className="hidden md:inline">Commit</span>
                  </button>
                </Tooltip>
              )}
              <div className="mx-1 h-5 w-px bg-border" />
              {isWorkspaceRepoHeaderControlDisabled ? (
                <button
                  type="button"
                  disabled={isWorkspaceRepoHeaderControlDisabled}
                  onClick={workspaceState.handleOpenSourceControlPanel}
                  className={[
                    'inline-flex h-10 items-center gap-1.5 text-sm transition-colors',
                    interfaceController.isSourceControlPanelOpen ? 'text-foreground' : 'text-muted-foreground',
                    isWorkspaceRepoHeaderControlDisabled ? 'cursor-not-allowed opacity-50' : 'hover:text-foreground',
                  ].join(' ')}
                >
                  <GitBranch size={16} className="shrink-0" />
                  <span className="hidden md:inline">Source Control</span>
                </button>
              ) : (
                <Tooltip content={hasRepository ? 'Toggle Source Control panel' : 'Open a git-backed folder'} side="bottom">
                  <button
                    type="button"
                    disabled={isWorkspaceRepoHeaderControlDisabled}
                    onClick={workspaceState.handleOpenSourceControlPanel}
                    className={[
                      'inline-flex h-10 items-center gap-1.5 text-sm transition-colors',
                      interfaceController.isSourceControlPanelOpen ? 'text-foreground' : 'text-muted-foreground',
                      isWorkspaceRepoHeaderControlDisabled ? 'cursor-not-allowed opacity-50' : 'hover:text-foreground',
                    ].join(' ')}
                  >
                    <GitBranch size={16} className="shrink-0" />
                    <span className="hidden md:inline">Source Control</span>
                  </button>
                </Tooltip>
              )}
              <div className="mx-1 h-5 w-px bg-border" />
              {isWorkspaceRepoHeaderControlDisabled ? (
                <button
                  type="button"
                  disabled={isWorkspaceRepoHeaderControlDisabled}
                  onClick={workspaceState.handleOpenDiffPanel}
                  className={[
                    'inline-flex h-10 items-center gap-1.5 text-sm transition-colors',
                    interfaceController.isDiffPanelOpen ? 'text-foreground' : 'text-muted-foreground',
                    isWorkspaceRepoHeaderControlDisabled ? 'cursor-not-allowed opacity-50' : 'hover:text-foreground',
                  ].join(' ')}
                >
                  <GitCompareArrows size={16} className="shrink-0" />
                  {hasRepository ? (
                    <>
                      <span className="text-emerald-600 dark:text-emerald-400">{`+${gitDiffSnapshot.snapshot.totalAddedLineCount}`}</span>
                      <span className="text-red-600 dark:text-red-400">{`-${gitDiffSnapshot.snapshot.totalRemovedLineCount}`}</span>
                    </>
                  ) : null}
                </button>
              ) : (
                <Tooltip content={hasRepository ? 'Toggle Diff panel' : 'Open a git-backed folder'} side="bottom">
                  <button
                    type="button"
                    disabled={isWorkspaceRepoHeaderControlDisabled}
                    onClick={workspaceState.handleOpenDiffPanel}
                    className={[
                      'inline-flex h-10 items-center gap-1.5 text-sm transition-colors',
                      interfaceController.isDiffPanelOpen ? 'text-foreground' : 'text-muted-foreground',
                      isWorkspaceRepoHeaderControlDisabled ? 'cursor-not-allowed opacity-50' : 'hover:text-foreground',
                    ].join(' ')}
                  >
                    <GitCompareArrows size={16} className="shrink-0" />
                    {hasRepository ? (
                      <>
                        <span className="text-emerald-600 dark:text-emerald-400">{`+${gitDiffSnapshot.snapshot.totalAddedLineCount}`}</span>
                        <span className="text-red-600 dark:text-red-400">{`-${gitDiffSnapshot.snapshot.totalRemovedLineCount}`}</span>
                      </>
                    ) : null}
                  </button>
                </Tooltip>
              )}
              <div className="mx-1 h-5 w-px bg-border" />
              {isWorkspaceHeaderControlDisabled ? (
                <button
                  type="button"
                  disabled={isWorkspaceHeaderControlDisabled}
                  onClick={workspaceState.handleToggleExplorerPanel}
                  className={[
                    'inline-flex h-10 items-center gap-1.5 text-sm transition-colors',
                    isWorkspaceHeaderControlDisabled
                      ? 'cursor-not-allowed opacity-50'
                      : workspaceState.isExplorerOpen
                        ? 'text-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                  ].join(' ')}
                >
                  <FolderTree size={16} className="shrink-0" />
                  <span className="hidden md:inline">Explorer</span>
                </button>
              ) : (
                <Tooltip content={workspaceState.isExplorerOpen ? 'Close explorer panel' : 'Open explorer panel'} side="bottom">
                  <button
                    type="button"
                    disabled={isWorkspaceHeaderControlDisabled}
                    onClick={workspaceState.handleToggleExplorerPanel}
                    className={[
                      'inline-flex h-10 items-center gap-1.5 text-sm transition-colors',
                      isWorkspaceHeaderControlDisabled
                        ? 'cursor-not-allowed opacity-50'
                        : workspaceState.isExplorerOpen
                          ? 'text-foreground'
                          : 'text-muted-foreground hover:text-foreground',
                    ].join(' ')}
                  >
                    <FolderTree size={16} className="shrink-0" />
                    <span className="hidden md:inline">Explorer</span>
                  </button>
                </Tooltip>
              )}
            </div>
          }
          onRenameTitle={(nextTitle) => {
            if (!chatMessages.activeConversationId) {
              return
            }

            return chatMessages.renameConversationTitle(chatMessages.activeConversationId, nextTitle)
          }}
        />

        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center overflow-hidden">
            <div className="flex min-h-0 w-full flex-1 flex-col">
              {isKanbanBoardOpen ? (
                <KanbanBoard
                  workspacePath={activeWorkspacePath}
                  messages={chatMessages.messages}
                />
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
                        messages={chatMessages.messages}
                        chatModeOptions={chatModeOptions}
                        editingMessageId={chatMessages.editingMessageId}
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
                        onSendEditedMessage={handleSendEditedMessage}
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
                {showQueueBlock ? (
                  <div className="chat-queue-shell">
                    <ChatQueueBlock
                      queuedMessages={queuedMessages}
                      editCancelBoundaryRef={messageListBoundaryRef}
                      onForceSend={forceSendQueuedMessage}
                      onRemove={removeQueuedMessage}
                      onUpdate={updateQueuedMessage}
                    />
                  </div>
                ) : null}

                <div className="chat-input-shell relative">
                  {showImplementPlanButton ? (
                    <button
                      type="button"
                      onClick={handleImplementPlan}
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
                    contextUsage={contextUsage}
                    codexUsage={codexUsage}
                    isCompressingChat={isCompressingChat}
                    onCompressChat={handleCompressChat}
                    refactorCandidates={refactorCandidates}
                    refactorCandidatesLoading={refactorCandidatesLoading}
                    value={chatMessages.mainComposerValue}
                    onAttachmentsChange={chatMessages.setMainComposerAttachments}
                    onValueChange={chatMessages.setMainComposerValue}
                    onSend={handleSendMainMessage}
                    onQueue={(value, attachments) => enqueueMessage(value, attachments)}
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
                    terminalExecutionMode={settings.terminalExecutionMode}
                    onTerminalExecutionModeChange={interfaceController.handleTerminalExecutionModeChange}
                    workspaceRootPath={activeWorkspacePath}
                  />
                </div>
              </div>
            ) : null}
          </div>
          {workspaceState.isWorkspaceTabsPanelOpen ? (
            <WorkspaceFileTabsPanel
              activeTabKey={workspaceState.activeWorkspaceTabKey}
              isOpen={workspaceState.isWorkspaceTabsPanelOpen}
              onCloseTab={workspaceState.handleCloseWorkspaceTab}
              onFileContentChange={workspaceState.handleWorkspaceFileContentChange}
              onOpenMarkdownPreview={workspaceState.handleOpenWorkspaceMarkdownPreview}
              onSelectTab={workspaceState.handleSelectWorkspaceTab}
              onWidthChange={workspaceState.handleWorkspaceEditorWidthChange}
              onWidthCommit={workspaceState.handleWorkspaceEditorWidthCommit}
              tabs={workspaceState.workspaceFileTabs}
              width={workspaceState.workspaceEditorWidth}
              wordWrapEnabled={settings.workspaceFileEditorWordWrap}
            />
          ) : null}
          {workspaceState.isExplorerOpen ? (
            <WorkspaceExplorerPanel
              activeFilePath={workspaceState.activeWorkspaceFilePath}
              clipboardEntry={workspaceState.workspaceClipboard}
              gitFileDiffs={gitDiffSnapshot.snapshot.fileDiffs}
              isOpen={workspaceState.isExplorerOpen}
              onCopyEntry={workspaceState.handleCopyWorkspaceEntry}
              onCreateEntry={workspaceState.handleCreateWorkspaceEntry}
              onCutEntry={workspaceState.handleCutWorkspaceEntry}
              onDeleteEntry={workspaceState.handleDeleteWorkspaceEntry}
              onImportEntry={workspaceState.handleImportWorkspaceEntry}
              onMoveEntry={workspaceState.handleMoveWorkspaceEntry}
              onOpenFile={workspaceState.handleOpenWorkspaceFile}
              onPasteEntry={workspaceState.handlePasteWorkspaceEntry}
              onRenameEntry={workspaceState.handleRenameWorkspaceEntry}
              onWidthChange={workspaceState.handleWorkspaceExplorerWidthChange}
              onWidthCommit={workspaceState.handleWorkspaceExplorerWidthCommit}
              width={workspaceState.workspaceExplorerWidth}
              workspaceRootPath={workspaceState.activeWorkspacePath}
            />
          ) : null}

          {interfaceController.isDiffPanelOpen ? (
            <ConversationDiffPanel
              currentBranch={gitBranchState.branchState.currentBranch}
              expandedFilePaths={diffPanelExpandedFilePaths}
              fileDiffs={gitDiffSnapshot.snapshot.fileDiffs}
              isOpen={interfaceController.isDiffPanelOpen}
              onDiscardFile={interfaceController.handleDiscardDiffFile}
              onExpandedFilePathsChange={onDiffPanelExpandedFilePathsChange}
              onStageFile={interfaceController.handleStageDiffFile}
              onSelectedScopeChange={onDiffPanelSelectedScopeChange}
              onUnstageFile={interfaceController.handleUnstageDiffFile}
              pendingFileActionPath={interfaceController.pendingFileActionPath}
              width={workspaceState.conversationDiffPanelWidth}
              onWidthChange={workspaceState.handleConversationDiffPanelWidthChange}
              onWidthCommit={workspaceState.handleConversationDiffPanelWidthCommit}
              selectedScope={diffPanelSelectedScope}
            />
          ) : null}

          {interfaceController.isSourceControlPanelOpen ? (
            <SourceControlPanel
              key={workspaceState.activeWorkspacePath?.trim() ?? 'no-workspace'}
              onDiffPanelExpandedFilePathsChange={onDiffPanelExpandedFilePathsChange}
              onDiffPanelSelectedScopeChange={onDiffPanelSelectedScopeChange}
              fileDiffs={gitDiffSnapshot.snapshot.fileDiffs}
              isOpen={interfaceController.isSourceControlPanelOpen}
              onDiscardFile={interfaceController.handleDiscardDiffFile}
              onOpenCommitModal={interfaceController.handleOpenCommitModal}
              onOpenDiffPanel={workspaceState.handleOpenDiffPanel}
              onQuickCommit={interfaceController.handleQuickCommit}
              onRefreshAll={interfaceController.handleRefreshGitUi}
              onSectionOpenChange={interfaceController.handleSourceControlSectionOpenChange}
              onStageFiles={interfaceController.handleStageDiffFiles}
              onStageFile={interfaceController.handleStageDiffFile}
              onUnstageFiles={interfaceController.handleUnstageDiffFiles}
              onUnstageFile={interfaceController.handleUnstageDiffFile}
              pendingFileActionPath={interfaceController.pendingFileActionPath}
              onWidthCommit={workspaceState.handleSourceControlPanelWidthCommit}
              onWidthChange={workspaceState.handleSourceControlPanelWidthChange}
              sectionOpen={settings.sourceControlSectionOpen}
              workspacePath={workspaceState.activeWorkspacePath}
              width={workspaceState.sourceControlPanelWidth}
            />
          ) : null}
        </div>
        <WorkspaceTerminalPanel
          isOpen={workspaceState.isTerminalOpen}
          onClose={() => interfaceController.setActiveWorkspaceTerminalOpen(false)}
          onHeightCommit={interfaceController.handleTerminalPanelHeightCommit}
          resolvedTheme={resolvedTheme}
          storedHeight={workspaceState.terminalPanelHeight}
          workspaceKey={workspaceState.activeTerminalWorkspaceKey}
          workspacePath={workspaceState.activeWorkspacePath}
        />
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
