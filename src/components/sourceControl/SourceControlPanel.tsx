import { GitCommitHorizontal } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toUserFacingErrorMessage } from '../../lib/userFacingError'
import type { ConversationFileDiff } from '../../lib/chatDiffs'
import type { DiffPanelScope } from '../chat/ConversationDiffPanel'
import type {
  GitCommitResult,
  GitSyncAction,
} from '../../types/chat'
import { describeSourceControlPendingAction, beginSourceControlSyncOperation, endSourceControlSyncOperation } from '../../lib/sourceControlPendingStateStore'
import { SourceControlChangesSection } from './SourceControlChangesSection'
import { SourceControlHistorySection } from './SourceControlHistorySection'
import { SourceControlNoRepoView } from './SourceControlNoRepoView'
import type { SourceControlOperationNotice } from './SourceControlOperationStatus'
import { useSourceControlPendingState } from '../../hooks/useSourceControlPendingState'
import { useSourceControlPanelSizing } from './useSourceControlPanelSizing'
import { useSourceControlHistory } from './useSourceControlHistory'

interface SourceControlPanelProps {
  aheadCommitCount: number
  hasRepository: boolean
  hasRemote: boolean
  onDiffPanelExpandedFilePathsChange: (nextFilePaths: string[]) => void


  onDiffPanelSelectedScopeChange: (nextScope: DiffPanelScope) => void
  fileDiffs: readonly ConversationFileDiff[]
  isOpen: boolean
  onDiscardFiles: (filePaths: string[]) => Promise<void>
  onDiscardFile: (filePath: string) => Promise<void>
  onOpenCommitModal: () => void
  onDiffPanelFileFocus: (filePath: string) => void
  onOpenDiffPanel: () => void
  onQuickCommit: (input: { action: 'commit' | 'commit-and-push'; message: string }) => Promise<GitCommitResult | null>
  onRefreshAll: () => Promise<void>
  onSectionOpenChange: (nextValue: Record<'changes' | 'commit' | 'history' | 'staged' | 'unstaged', boolean>) => void
  onStageFiles: (filePaths: string[]) => Promise<void>
  onStageFile: (filePath: string) => Promise<void>
  onUnstageFiles: (filePaths: string[]) => Promise<void>
  onUnstageFile: (filePath: string) => Promise<void>
  onWidthChange: (nextWidth: number) => void
  onWidthCommit?: (nextWidth: number) => void
  pendingFileActionPath: string | null
  fileActionErrorMessage: string | null
  sectionOpen: Record<'changes' | 'commit' | 'history' | 'staged' | 'unstaged', boolean>
  width: number
  workspacePath: string | null | undefined
}

function SourceControlPanelContent({
  aheadCommitCount,
  hasRepository,
  hasRemote,
  onDiffPanelExpandedFilePathsChange,


  onDiffPanelSelectedScopeChange,
  fileDiffs,
  isOpen,
  onDiscardFiles,
  onDiscardFile,
  onOpenCommitModal,
  onDiffPanelFileFocus,
  onOpenDiffPanel,
  onQuickCommit,
  onRefreshAll,
  onSectionOpenChange,
  onStageFiles,
  onStageFile,
  onUnstageFiles,
  onUnstageFile,
  onWidthChange,
  onWidthCommit,
  pendingFileActionPath,
  fileActionErrorMessage,
  sectionOpen,
  width,
  workspacePath,
}: SourceControlPanelProps) {
  const commitActionControlsRef = useRef<HTMLDivElement | null>(null)
  const [commitMessage, setCommitMessage] = useState('')
  const [isCommitActionMenuOpen, setIsCommitActionMenuOpen] = useState(false)
  const [operationNotice, setOperationNotice] = useState<SourceControlOperationNotice | null>(null)
  const [isChangesSectionOpen, setIsChangesSectionOpen] = useState(sectionOpen.changes)
  const [isHistorySectionOpen, setIsHistorySectionOpen] = useState(sectionOpen.history)
  const [isStagedSectionOpen, setIsStagedSectionOpen] = useState(sectionOpen.staged)
  const [isUnstagedSectionOpen, setIsUnstagedSectionOpen] = useState(sectionOpen.unstaged)

  const normalizedWorkspacePath = workspacePath?.trim() ?? ''
  const hasWorkspacePath = normalizedWorkspacePath.length > 0
  const {
    appendCommittedHistoryEntry,
    commitDetailsByHash,
    expandedCommitHashes,
    handleCommitExpandedToggle,
    handleGoToCurrentCommit,
    hasMoreHistory,
    headHash,
    historyEntries,
    historyError,
    historyRowRefMap,
    historyViewModels,
    isLoadingHistory,
    isLoadingMoreHistory,
    loadCommitDetails,
    loadMoreHistory,
    loadingCommitHashes,
    refreshHistory,
    selectedCommitHash,
  } = useSourceControlHistory({ hasRepository, isOpen, normalizedWorkspacePath })
  const pendingState = useSourceControlPendingState(normalizedWorkspacePath)
  const pendingCommitOperation = pendingState?.commit ?? null
  const pendingSyncOperation = pendingState?.sync ?? null
  const previousPendingCommitOperationRef = useRef(pendingCommitOperation)
  const isSourceControlBusy = pendingCommitOperation !== null || pendingSyncOperation !== null
  const isFileActionInProgress = pendingFileActionPath !== null
  const isAnyOperationInProgress = isSourceControlBusy || isFileActionInProgress
  const isUnstagedLikeFileDiff = useCallback(
    (fileDiff: ConversationFileDiff) =>
      fileDiff.isUnstaged || fileDiff.isUntracked || (!fileDiff.isStaged && !fileDiff.isUnstaged && !fileDiff.isUntracked),
    [],
  )
  const stagedFileDiffs = useMemo(() => fileDiffs.filter((fileDiff) => fileDiff.isStaged), [fileDiffs])
  const unstagedFileDiffs = useMemo(
    () => fileDiffs.filter((fileDiff) => isUnstagedLikeFileDiff(fileDiff)),
    [fileDiffs, isUnstagedLikeFileDiff],
  )
  const shouldUseSplitLayout = isChangesSectionOpen
  const displayedOperationNotice: SourceControlOperationNotice | null = fileActionErrorMessage
    ? { kind: 'error', message: fileActionErrorMessage }
    : operationNotice
  const {
    handleHistoryResizePointerDown,
    handleResizePointerDown,
    historyHeight,
    isHistoryResizing,
    panelBodyRef,
    panelRef,
    renderedWidth,
  } = useSourceControlPanelSizing({
    isHistorySectionOpen,
    isOpen,
    onWidthChange,
    onWidthCommit,
    shouldUseSplitLayout,
    width,
  })
  const canQuickCommit = fileDiffs.length > 0 && !isAnyOperationInProgress
  const isCommitActionDisabled = !canQuickCommit || isAnyOperationInProgress
  const isQuickCommitting = pendingCommitOperation !== null
  const pendingSyncAction: GitSyncAction | 'refresh' | null = pendingSyncOperation?.action ?? null
  const isCommitPrimaryBusy = isQuickCommitting || pendingSyncAction === 'push'
  const isSyncingChanges = pendingSyncAction === 'sync'
  const pendingOperationLabel = pendingCommitOperation
    ? describeSourceControlPendingAction(pendingCommitOperation.action)
    : pendingSyncOperation && pendingSyncOperation.action !== 'refresh'
      ? describeSourceControlPendingAction(pendingSyncOperation.action)
      : null

  useEffect(() => {
    if (isChangesSectionOpen !== sectionOpen.changes) {
      setIsChangesSectionOpen(sectionOpen.changes)
    }
    if (isHistorySectionOpen !== sectionOpen.history) {
      setIsHistorySectionOpen(sectionOpen.history)
    }
    if (isStagedSectionOpen !== sectionOpen.staged) {
      setIsStagedSectionOpen(sectionOpen.staged)
    }
    if (isUnstagedSectionOpen !== sectionOpen.unstaged) {
      setIsUnstagedSectionOpen(sectionOpen.unstaged)
    }
  }, [
    isChangesSectionOpen,
    isHistorySectionOpen,
    isStagedSectionOpen,
    isUnstagedSectionOpen,
    sectionOpen.changes,
    sectionOpen.history,
    sectionOpen.staged,
    sectionOpen.unstaged,
  ])

  const persistSectionOpen = useCallback(
    (nextValue: Partial<Record<'changes' | 'commit' | 'history' | 'staged' | 'unstaged', boolean>>) => {
      onSectionOpenChange({
        ...sectionOpen,
        ...nextValue,
      })
    },
    [onSectionOpenChange, sectionOpen],
  )


  useEffect(() => {
    const previous = previousPendingCommitOperationRef.current
    previousPendingCommitOperationRef.current = pendingCommitOperation

    if (previous !== null && pendingCommitOperation === null) {
      void refreshHistory({ silent: true })
    }
  }, [pendingCommitOperation, refreshHistory])

  useEffect(() => {
    if (!isCommitActionMenuOpen) {
      return
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target
      if (!(target instanceof Node)) {
        return
      }
      if (!commitActionControlsRef.current?.contains(target)) {
        setIsCommitActionMenuOpen(false)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsCommitActionMenuOpen(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isCommitActionMenuOpen])

  useEffect(() => {
    if (operationNotice?.kind !== 'success') {
      return
    }

    const noticeToDismiss = operationNotice
    const timeoutId = window.setTimeout(() => {
      setOperationNotice((currentValue) => (currentValue === noticeToDismiss ? null : currentValue))
    }, 3000)

    return () => window.clearTimeout(timeoutId)
  }, [operationNotice])

  async function performSyncAction(action: GitSyncAction): Promise<boolean> {
    if (!hasWorkspacePath) {
      return false
    }

    const pendingSyncOperation = beginSourceControlSyncOperation(normalizedWorkspacePath, action)
    setOperationNotice(null)
    try {
      const result = await window.tidecodeGit.sync({
        action,
        workspacePath: normalizedWorkspacePath,
      })
      setOperationNotice({ kind: 'success', message: result.message })
      await onRefreshAll()
      if (action !== 'push') {
        await refreshHistory({ silent: true })
      }
      return true
    } catch (error) {
      setOperationNotice({
        kind: 'error',
        message: toUserFacingErrorMessage(error, `The ${action} action could not be completed.`),
      })
      return false
    } finally {
      if (pendingSyncOperation) {
        endSourceControlSyncOperation(normalizedWorkspacePath, pendingSyncOperation.sequence)
      }
    }
  }

  async function handleSyncAction(action: GitSyncAction) {
    await performSyncAction(action)
  }

  async function handleSyncChanges() {
    await performSyncAction('sync')
  }

  async function handleRefreshPanel() {
    const pendingRefreshOperation = beginSourceControlSyncOperation(normalizedWorkspacePath, 'refresh')
    setOperationNotice(null)
    try {
      await Promise.all([onRefreshAll(), refreshHistory({ silent: true })])
    } catch (error) {
      setOperationNotice({
        kind: 'error',
        message: toUserFacingErrorMessage(error, 'Source control could not be refreshed.'),
      })
    } finally {
      if (pendingRefreshOperation) {
        endSourceControlSyncOperation(normalizedWorkspacePath, pendingRefreshOperation.sequence)
      }
    }
  }

  async function handleQuickCommitSubmit(action: 'commit' | 'commit-and-push' = 'commit') {
    if (isCommitActionDisabled) {
      return
    }

    setIsCommitActionMenuOpen(false)
    setOperationNotice(null)

    try {
      const commitResult = await onQuickCommit({
        action,
        message: commitMessage,
      })

      if (commitResult) {
        await appendCommittedHistoryEntry(commitResult)
      }
      setCommitMessage('')
      setOperationNotice({
        kind: 'success',
        message: action === 'commit-and-push' ? 'Committed and pushed changes.' : 'Committed changes.',
      })
    } catch (error) {
      setOperationNotice({
        kind: 'error',
        message: toUserFacingErrorMessage(error, 'The changes could not be committed.'),
      })
    }
  }

  function handleOpenDiffPanelForFile(filePath: string, scope: DiffPanelScope) {
    onDiffPanelSelectedScopeChange(scope)
    onDiffPanelExpandedFilePathsChange([filePath])
    onDiffPanelFileFocus(filePath)
    onOpenDiffPanel()
  }

  function handleToggleChangesSection() {
    const nextValue = !isChangesSectionOpen
    setIsChangesSectionOpen(nextValue)
    persistSectionOpen({ changes: nextValue })
  }

  function handleStagedSectionOpenChange(nextValue: boolean) {
    setIsStagedSectionOpen(nextValue)
    persistSectionOpen({ staged: nextValue })
  }

  function handleUnstagedSectionOpenChange(nextValue: boolean) {
    setIsUnstagedSectionOpen(nextValue)
    persistSectionOpen({ unstaged: nextValue })
  }

  function handleToggleHistorySection() {
    const nextValue = !isHistorySectionOpen
    setIsHistorySectionOpen(nextValue)
    persistSectionOpen({ history: nextValue })
  }

  return (
    <div
      ref={panelRef}
      className={[
        'relative flex h-full min-w-0 shrink-0 overflow-hidden max-md:hidden',
        isOpen ? 'pointer-events-auto' : 'pointer-events-none invisible',
      ].join(' ')}
      aria-hidden={!isOpen}
      style={{ width: isOpen ? `${renderedWidth}px` : '0px' }}
    >
      {isOpen ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize source control panel"
          onPointerDown={handleResizePointerDown}
          className="absolute inset-y-0 left-0 z-20 w-3 -translate-x-1/2 cursor-col-resize"
        />
      ) : null}

      <aside className="flex h-full min-w-0 flex-1 flex-col border-l border-border bg-[var(--workspace-panel-surface)]">
        <div className="flex h-14 shrink-0 items-center justify-between px-4">
          <div className="flex min-w-0 items-center gap-2">
            <GitCommitHorizontal size={16} className="text-muted-foreground" />
            <span className="truncate text-sm font-semibold text-foreground">SOURCE CONTROL</span>
          </div>
        </div>

        <div className="h-px w-full bg-border" />

        <div
          ref={panelBodyRef}
          className={[
            'min-h-0 flex flex-1 flex-col overflow-hidden',
            isHistoryResizing ? 'cursor-row-resize' : '',
          ].join(' ')}
        >
          {!hasRepository && hasWorkspacePath ? (
            <SourceControlNoRepoView
              workspacePath={normalizedWorkspacePath}
              onRefreshAll={onRefreshAll}
            />
          ) : (
            <>

          <SourceControlChangesSection
            aheadCommitCount={aheadCommitCount}
            commitActionControlsRef={commitActionControlsRef}
            commitMessage={commitMessage}
            isOperationInProgress={isAnyOperationInProgress}
            isChangesSectionOpen={isChangesSectionOpen}
            isCommitActionDisabled={isCommitActionDisabled}
            isCommitActionMenuOpen={isCommitActionMenuOpen}
            isCommitPrimaryBusy={isCommitPrimaryBusy}
            isQuickCommitting={isQuickCommitting}
            isSyncingChanges={isSyncingChanges}
            isStagedSectionOpen={isStagedSectionOpen}
            isUnstagedSectionOpen={isUnstagedSectionOpen}
            hasRemote={hasRemote}
            operationNotice={displayedOperationNotice}
            pendingFileActionPath={pendingFileActionPath}
            pendingOperationLabel={pendingOperationLabel}
            stagedFileCount={stagedFileDiffs.length}
            stagedFileDiffs={stagedFileDiffs}
            unstagedFileCount={unstagedFileDiffs.length}
            unstagedFileDiffs={unstagedFileDiffs}
            workspacePath={normalizedWorkspacePath}
            onCommitActionMenuOpenChange={setIsCommitActionMenuOpen}
            onCommitMessageChange={setCommitMessage}
            onDiscardFiles={onDiscardFiles}
            onDiscardFile={onDiscardFile}
            onOpenCommitModal={onOpenCommitModal}
            onQuickCommitSubmit={handleQuickCommitSubmit}
            onSyncChanges={handleSyncChanges}
            onOpenDiffPanelForFile={handleOpenDiffPanelForFile}
            onStageFiles={onStageFiles}
            onStageFile={onStageFile}
            onStagedSectionOpenChange={handleStagedSectionOpenChange}
            onToggleChangesSection={handleToggleChangesSection}
            onUnstageFiles={onUnstageFiles}
            onUnstageFile={onUnstageFile}
            onUnstagedSectionOpenChange={handleUnstagedSectionOpenChange}
            onPublishSuccess={onRefreshAll}
          />


          <SourceControlHistorySection
            commitDetailsByHash={commitDetailsByHash}
            expandedCommitHashes={expandedCommitHashes}
            hasMoreHistory={hasMoreHistory}
            hasWorkspacePath={hasWorkspacePath}
            headHash={headHash}
            historyEntries={historyEntries}
            historyError={historyError}
            historyHeight={shouldUseSplitLayout ? historyHeight : null}
            historyRowRefMap={historyRowRefMap}
            historyViewModels={historyViewModels}
            isHistorySectionOpen={isHistorySectionOpen}
            isLoadingHistory={isLoadingHistory}
            isLoadingMoreHistory={isLoadingMoreHistory}
            isOperationInProgress={isAnyOperationInProgress}
            loadingCommitHashes={loadingCommitHashes}
            pendingSyncAction={pendingSyncAction}
            selectedCommitHash={selectedCommitHash}
            showResizeHandle={shouldUseSplitLayout}
            onGoToCurrentCommit={handleGoToCurrentCommit}
            onHistoryResizePointerDown={handleHistoryResizePointerDown}
            onLoadCommitDetails={loadCommitDetails}
            onLoadMoreHistory={loadMoreHistory}
            onRefreshPanel={handleRefreshPanel}
            onSyncAction={handleSyncAction}
            onToggleCommitExpanded={handleCommitExpandedToggle}
            onToggleHistorySection={handleToggleHistorySection}
          />
            </>
          )}
        </div>
      </aside>
    </div>
  )
}


export const SourceControlPanel = memo(SourceControlPanelContent)
