import { useCallback, useEffect, useRef, useState } from 'react'
import { useWorkspaceKeyboardShortcuts } from './useWorkspaceKeyboardShortcuts'
import type { AppSettings, GitCommitAction, GitCommitResult } from '../types/chat'

export type ChatInterfaceRightPanelTab = 'diff' | 'source-control'

interface CommitSuccessDialogState {
  action: GitCommitAction
  result: GitCommitResult
}

interface UseChatInterfaceControllerInput {
  activeWorkspacePath: string | null
  createConversation: () => Promise<void> | void
  gitBranchState: {
    branchState: {
      currentBranch: string | null
    }
    refresh: () => Promise<void>
  }
  gitCommitState: {
    commit: (input: {
      action: GitCommitAction
      includeUnstaged?: boolean
      message: string
      preferredBranchName?: string
    }) => Promise<GitCommitResult | null>
    refreshStatus: () => Promise<void>
    resetResult: () => void
  }
  hasRepository: boolean
  isActiveScreen: boolean
  isRightPanelOpen: boolean
  messagesLength: number
  onDiffRefresh: (input?: { forceRefresh?: boolean; silent?: boolean }) => Promise<void>
  onRightPanelOpenChange: (nextValue: boolean) => void
  onRightPanelTabChange: (nextTab: ChatInterfaceRightPanelTab) => void
  onSidebarOpenChange?: (nextValue: boolean) => void
  onUpdateSettings: (input: Partial<AppSettings>) => Promise<AppSettings | null>
  rightPanelTab: ChatInterfaceRightPanelTab
  settings: AppSettings
  activeTerminalWorkspaceKey: string
}

export function useChatInterfaceController(input: UseChatInterfaceControllerInput) {
  const {
    activeTerminalWorkspaceKey,
    activeWorkspacePath,
    createConversation,
    gitBranchState,
    gitCommitState,
    hasRepository,
    isActiveScreen,
    isRightPanelOpen,
    messagesLength,
    onDiffRefresh,
    onRightPanelOpenChange,
    onRightPanelTabChange,
    onSidebarOpenChange,
    onUpdateSettings,
    rightPanelTab,
    settings,
  } = input
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [isCommitModalOpen, setIsCommitModalOpen] = useState(false)
  const [commitSuccessDialog, setCommitSuccessDialog] = useState<CommitSuccessDialogState | null>(null)
  const [pendingFileActionPath, setPendingFileActionPath] = useState<string | null>(null)
  const previousWorkspacePathRef = useRef<string | null>(null)
  const activeWorkspacePathRef = useRef<string | null>(activeWorkspacePath?.trim() ?? null)

  const isDiffPanelOpen = isRightPanelOpen && rightPanelTab === 'diff'
  const isSourceControlPanelOpen = isRightPanelOpen && rightPanelTab === 'source-control'

  useEffect(() => {
    // Only force-close the right panel if there's truly no workspace path at all.
    // Source Control can open without a repo (to offer init/publish).
    if (!hasRepository && isRightPanelOpen && rightPanelTab !== 'source-control') {
      onRightPanelOpenChange(false)
    }
  }, [hasRepository, isRightPanelOpen, onRightPanelOpenChange, rightPanelTab])

  useEffect(() => {
    if (!hasRepository) {
      setPendingFileActionPath(null)
    }
  }, [hasRepository])

  useEffect(() => {
    activeWorkspacePathRef.current = activeWorkspacePath?.trim() ?? null
  }, [activeWorkspacePath])

  useEffect(() => {
    if (!hasRepository) {
      return
    }

    const normalizedWorkspacePath = activeWorkspacePath?.trim() ?? ''
    const workspacePathKey = normalizedWorkspacePath.length > 0 ? normalizedWorkspacePath : null
    const workspaceChanged = previousWorkspacePathRef.current !== workspacePathKey
    previousWorkspacePathRef.current = workspacePathKey

    void onDiffRefresh({
      forceRefresh: !workspaceChanged,
      silent: true,
    })
  }, [
    activeWorkspacePath,
    gitBranchState.branchState.currentBranch,
    hasRepository,
    messagesLength,
    onDiffRefresh,
  ])

  const handleToggleSidebar = useCallback(() => {
    setIsSidebarOpen((currentValue) => {
      const nextValue = !currentValue
      onSidebarOpenChange?.(nextValue)
      return nextValue
    })
  }, [onSidebarOpenChange])

  useWorkspaceKeyboardShortcuts({
    enabled: isActiveScreen,
    onToggleDiffPanel: () => {
      if (!hasRepository) {
        return
      }

      if (isDiffPanelOpen) {
        onRightPanelOpenChange(false)
        return
      }

      onRightPanelTabChange('diff')
      onRightPanelOpenChange(true)
    },
    onToggleSidebar: handleToggleSidebar,
    onCreateConversation: createConversation,
  })

  const handleOpenCommitModal = useCallback(() => {
    if (!hasRepository) {
      return
    }

    if (isRightPanelOpen && rightPanelTab === 'source-control') {
      onRightPanelOpenChange(false)
    }

    gitCommitState.resetResult()
    void gitCommitState.refreshStatus()
    setIsCommitModalOpen(true)
  }, [gitCommitState, hasRepository, isRightPanelOpen, onRightPanelOpenChange, rightPanelTab])

  const handleCloseCommitModal = useCallback(() => {
    setIsCommitModalOpen(false)
  }, [])

  const handleCloseCommitSuccessDialog = useCallback(() => {
    setCommitSuccessDialog(null)
  }, [])

  const handleCommit = useCallback(
    async (commitInput: {
      action: GitCommitAction
      includeUnstaged?: boolean
      message: string
      preferredBranchName?: string
    }) => {
      const workspacePathAtStart = activeWorkspacePathRef.current
      const commitResult = await gitCommitState.commit(commitInput)
      if (!commitResult || workspacePathAtStart !== activeWorkspacePathRef.current) {
        return
      }

      setIsCommitModalOpen(false)
      setCommitSuccessDialog({
        action: commitInput.action,
        result: commitResult,
      })

      void onDiffRefresh({ forceRefresh: true })
      void gitBranchState.refresh()
    },
    [gitBranchState, gitCommitState, onDiffRefresh],
  )

  const handleGitFileAction = useCallback(
    async (filePath: string, action: 'stage' | 'unstage' | 'discard') => {
      const normalizedWorkspacePath = activeWorkspacePath?.trim() ?? ''
      if (!hasRepository || normalizedWorkspacePath.length === 0) {
        return
      }

      setPendingFileActionPath(filePath)
      try {
        if (action === 'stage') {
          await window.echosphereGit.stageFile({ filePath, workspacePath: normalizedWorkspacePath })
        } else if (action === 'unstage') {
          await window.echosphereGit.unstageFile({ filePath, workspacePath: normalizedWorkspacePath })
        } else {
          await window.echosphereGit.discardFileChanges({ filePath, workspacePath: normalizedWorkspacePath })
        }
        await onDiffRefresh({ forceRefresh: true, silent: true })
      } catch (error) {
        console.error(`Failed to ${action} file from git panel`, error)
      } finally {
        setPendingFileActionPath(null)
      }
    },
    [activeWorkspacePath, hasRepository, onDiffRefresh],
  )

  const handleGitFileBatchAction = useCallback(
    async (filePaths: string[], action: 'stage' | 'unstage' | 'discard') => {
      const normalizedWorkspacePath = activeWorkspacePath?.trim() ?? ''
      if (!hasRepository || normalizedWorkspacePath.length === 0 || filePaths.length === 0) {
        return
      }

      setPendingFileActionPath(filePaths[0] ?? null)
      try {
        if (action === 'stage') {
          await window.echosphereGit.stageFiles({ filePaths, workspacePath: normalizedWorkspacePath })
        } else if (action === 'unstage') {
          await window.echosphereGit.unstageFiles({ filePaths, workspacePath: normalizedWorkspacePath })
        } else {
          for (const filePath of filePaths) {
            await window.echosphereGit.discardFileChanges({ filePath, workspacePath: normalizedWorkspacePath })
          }
        }
        await onDiffRefresh({ forceRefresh: true, silent: true })
      } catch (error) {
        console.error(`Failed to ${action} files from git panel`, error)
      } finally {
        setPendingFileActionPath(null)
      }
    },
    [activeWorkspacePath, hasRepository, onDiffRefresh],
  )

  const handleOpenRightPanelTab = useCallback(
    (tab: ChatInterfaceRightPanelTab) => {
      // Diff panel requires a repo; Source Control panel can open without one
      if (!hasRepository && tab !== 'source-control') {
        return
      }

      if (isRightPanelOpen && rightPanelTab === tab) {
        onRightPanelOpenChange(false)
        return
      }

      onRightPanelTabChange(tab)
      onRightPanelOpenChange(true)
    },
    [hasRepository, isRightPanelOpen, onRightPanelOpenChange, onRightPanelTabChange, rightPanelTab],
  )

  const handleRefreshGitUi = useCallback(async () => {
    await Promise.all([onDiffRefresh({ forceRefresh: true, silent: true }), gitBranchState.refresh()])
  }, [gitBranchState, onDiffRefresh])

  const handleQuickCommit = useCallback(
    async (commitInput: { message: string }) => {
      const workspacePathAtStart = activeWorkspacePathRef.current
      const commitResult = await gitCommitState.commit({
        action: 'commit',
        message: commitInput.message,
      })

      if (!commitResult || workspacePathAtStart !== activeWorkspacePathRef.current) {
        return null
      }

      await Promise.all([onDiffRefresh({ forceRefresh: true }), gitBranchState.refresh(), gitCommitState.refreshStatus()])
      return commitResult
    },
    [gitBranchState, gitCommitState, onDiffRefresh],
  )

  const handleSourceControlSectionOpenChange = useCallback(
    (sourceControlSectionOpen: AppSettings['sourceControlSectionOpen']) => {
      void onUpdateSettings({ sourceControlSectionOpen })
    },
    [onUpdateSettings],
  )

  const handleTerminalExecutionModeChange = useCallback(
    (terminalExecutionMode: AppSettings['terminalExecutionMode']) => {
      if (terminalExecutionMode === settings.terminalExecutionMode) {
        return
      }

      void onUpdateSettings({ terminalExecutionMode })
    },
    [onUpdateSettings, settings.terminalExecutionMode],
  )

  const setActiveWorkspaceTerminalOpen = useCallback(
    (nextOpen: boolean) => {
      const currentOpenByWorkspace = settings.terminalOpenByWorkspace
      const currentOpen = currentOpenByWorkspace[activeTerminalWorkspaceKey] ?? false
      if (currentOpen === nextOpen) {
        return
      }

      void onUpdateSettings({
        terminalOpenByWorkspace: {
          ...currentOpenByWorkspace,
          [activeTerminalWorkspaceKey]: nextOpen,
        },
      })
    },
    [activeTerminalWorkspaceKey, onUpdateSettings, settings.terminalOpenByWorkspace],
  )

  const handleTerminalPanelHeightCommit = useCallback(
    (nextHeight: number) => {
      const currentHeightsByWorkspace = settings.terminalPanelHeightsByWorkspace
      const currentOpenByWorkspace = settings.terminalOpenByWorkspace
      const nextOpenByWorkspace =
        currentOpenByWorkspace[activeTerminalWorkspaceKey] === true
          ? currentOpenByWorkspace
          : {
              ...currentOpenByWorkspace,
              [activeTerminalWorkspaceKey]: true,
            }
      if (
        currentHeightsByWorkspace[activeTerminalWorkspaceKey] === nextHeight &&
        nextOpenByWorkspace === currentOpenByWorkspace
      ) {
        return
      }

      void onUpdateSettings({
        terminalOpenByWorkspace: nextOpenByWorkspace,
        terminalPanelHeightsByWorkspace: {
          ...currentHeightsByWorkspace,
          [activeTerminalWorkspaceKey]: nextHeight,
        },
      })
    },
    [
      activeTerminalWorkspaceKey,
      onUpdateSettings,
      settings.terminalOpenByWorkspace,
      settings.terminalPanelHeightsByWorkspace,
    ],
  )

  return {
    commitSuccessDialog,
    handleCloseCommitModal,
    handleCloseCommitSuccessDialog,
    handleCommit,
    handleDiscardDiffFiles: (filePaths: string[]) => handleGitFileBatchAction(filePaths, 'discard'),
    handleDiscardDiffFile: (filePath: string) => handleGitFileAction(filePath, 'discard'),
    handleOpenCommitModal,
    handleOpenRightPanelTab,
    handleQuickCommit,
    handleRefreshGitUi,
    handleSourceControlSectionOpenChange,
    handleStageDiffFiles: (filePaths: string[]) => handleGitFileBatchAction(filePaths, 'stage'),
    handleStageDiffFile: (filePath: string) => handleGitFileAction(filePath, 'stage'),
    handleTerminalExecutionModeChange,
    handleTerminalPanelHeightCommit,
    handleUnstageDiffFiles: (filePaths: string[]) => handleGitFileBatchAction(filePaths, 'unstage'),
    handleUnstageDiffFile: (filePath: string) => handleGitFileAction(filePath, 'unstage'),
    isCommitModalOpen,
    isDiffPanelOpen,
    isSidebarOpen,
    isSourceControlPanelOpen,
    pendingFileActionPath,
    setActiveWorkspaceTerminalOpen,
    setIsSidebarOpen,
    handleToggleSidebar,
  }
}

export type ChatInterfaceControllerState = ReturnType<typeof useChatInterfaceController>
