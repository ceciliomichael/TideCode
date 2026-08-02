import { useCallback, useState } from 'react'
import { ConversationDiffPanel, type DiffPanelScope } from '../../components/chat/ConversationDiffPanel'
import { SourceControlPanel } from '../../components/sourceControl/SourceControlPanel'
import { WorkspaceExplorerPanel } from '../../components/workspaceExplorer/WorkspaceExplorerPanel'
import { WorkspaceFileTabsPanel } from '../../components/workspaceExplorer/WorkspaceFileTabsPanel'
import type { ChatInterfaceControllerState } from '../../hooks/useChatInterfaceController'
import type { GitBranchStateController } from '../../hooks/useGitBranchState'
import type { GitDiffSnapshotController } from '../../hooks/useGitDiffSnapshot'
import type { AppSettings } from '../../types/chat'
import type { ChatWorkspaceUiState } from './useChatWorkspaceUiState'

interface ChatWorkspaceSidePanelsProps {
  diffPanelExpandedFilePaths: readonly string[]
  diffPanelSelectedScope: DiffPanelScope
  gitBranchState: GitBranchStateController
  gitDiffSnapshot: GitDiffSnapshotController
  interfaceController: ChatInterfaceControllerState
  onDiffPanelExpandedFilePathsChange: (nextFilePaths: string[]) => void
  onDiffPanelSelectedScopeChange: (nextScope: DiffPanelScope) => void
  settings: AppSettings
  workspaceState: ChatWorkspaceUiState
}

export function ChatWorkspaceSidePanels({
  diffPanelExpandedFilePaths,
  diffPanelSelectedScope,
  gitBranchState,
  gitDiffSnapshot,
  interfaceController,
  onDiffPanelExpandedFilePathsChange,
  onDiffPanelSelectedScopeChange,
  settings,
  workspaceState,
}: ChatWorkspaceSidePanelsProps) {
  const hasRepository = gitBranchState.branchState.hasRepository
  const [diffPanelFilePathToFocus, setDiffPanelFilePathToFocus] = useState<string | null>(null)
  const handleDiffPanelFileFocus = useCallback((filePath: string) => {
    setDiffPanelFilePathToFocus(filePath)
  }, [])
  const handleDiffPanelFileFocusHandled = useCallback(() => {
    setDiffPanelFilePathToFocus(null)
  }, [])

  return (
    <>
      {workspaceState.isWorkspaceTabsPanelOpen ? (
        <WorkspaceFileTabsPanel
          activeTabKey={workspaceState.activeWorkspaceTabKey}
          gitFileDiffs={gitDiffSnapshot.snapshot.fileDiffs}
          hasRepository={hasRepository}
          isOpen={workspaceState.isWorkspaceTabsPanelOpen}
          onCloseTab={workspaceState.handleCloseWorkspaceTab}
          onFileContentChange={workspaceState.handleWorkspaceFileContentChange}
          onOpenMarkdownPreview={workspaceState.handleOpenWorkspaceMarkdownPreview}
          onOpenSvgPreview={workspaceState.handleOpenWorkspaceSvgPreview}
          onSelectTab={workspaceState.handleSelectWorkspaceTab}
          tabs={workspaceState.workspaceFileTabs}
          wordWrapEnabled={settings.workspaceFileEditorWordWrap}
        />
      ) : null}
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
      <ConversationDiffPanel
        currentBranch={gitBranchState.branchState.currentBranch}
        expandedFilePaths={diffPanelExpandedFilePaths}
        fileDiffs={gitDiffSnapshot.snapshot.fileDiffs}
        isOpen={interfaceController.isDiffPanelOpen}
        onDiscardFile={interfaceController.handleDiscardDiffFile}
        onExpandedFilePathsChange={onDiffPanelExpandedFilePathsChange}
        onScrollToFilePath={handleDiffPanelFileFocusHandled}
        onSelectedScopeChange={onDiffPanelSelectedScopeChange}
        onStageFile={interfaceController.handleStageDiffFile}
        onUnstageFile={interfaceController.handleUnstageDiffFile}
        pendingFileActionPath={interfaceController.pendingFileActionPath}
        scrollToFilePath={diffPanelFilePathToFocus}
        width={workspaceState.conversationDiffPanelWidth}
        onWidthChange={workspaceState.handleConversationDiffPanelWidthChange}
        onWidthCommit={workspaceState.handleConversationDiffPanelWidthCommit}
        selectedScope={diffPanelSelectedScope}
      />
      <SourceControlPanel
        key={workspaceState.activeWorkspacePath?.trim() ?? 'no-workspace'}
        aheadCommitCount={gitBranchState.branchState.aheadCommitCount}
        hasRepository={hasRepository}
        hasRemote={Boolean(gitBranchState.branchState.remoteUrl)}
        onDiffPanelExpandedFilePathsChange={onDiffPanelExpandedFilePathsChange}
        onDiffPanelSelectedScopeChange={onDiffPanelSelectedScopeChange}
        fileDiffs={gitDiffSnapshot.snapshot.fileDiffs}
        isOpen={interfaceController.isSourceControlPanelOpen}
        onDiscardFiles={interfaceController.handleDiscardDiffFiles}
        onDiscardFile={interfaceController.handleDiscardDiffFile}
        onOpenCommitModal={interfaceController.handleOpenCommitModal}
        onDiffPanelFileFocus={handleDiffPanelFileFocus}
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
    </>
  )
}
