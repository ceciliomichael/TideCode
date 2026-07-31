import { GitCommitHorizontal } from 'lucide-react'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { ConversationFileDiff } from '../../lib/chatDiffs'
import type { DiffPanelScope } from '../chat/ConversationDiffPanel'
import { getMaxDiffPanelWidth, getMinDiffPanelWidth } from '../../lib/diffPanelSizing'
import { clampSourceControlHistoryHeight, getDefaultSourceControlHistoryHeight } from '../../lib/sourceControlSizing'
import type {
  GitHistoryCommitDetailsResult,
  GitHistoryEntry,
  GitCommitResult,
  GitSyncAction,
} from '../../types/chat'
import { describeSourceControlPendingAction, beginSourceControlSyncOperation, endSourceControlSyncOperation } from '../../lib/sourceControlPendingStateStore'
import { SourceControlChangesSection } from './SourceControlChangesSection'
import { SourceControlHistorySection } from './SourceControlHistorySection'
import { SourceControlNoRepoView } from './SourceControlNoRepoView'
import type { SourceControlOperationNotice } from './SourceControlOperationStatus'
import { computeSwimlanes } from './historyGraphLayout'

import { prependCommittedHistoryEntry } from './sourceControlHistoryUtils'
import { useSourceControlPendingState } from '../../hooks/useSourceControlPendingState'

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
  onOpenDiffPanel: () => void
  onQuickCommit: (input: { message: string }) => Promise<GitCommitResult | null>
  onRefreshAll: () => Promise<void>
  onSectionOpenChange: (nextValue: Record<'changes' | 'commit' | 'history' | 'staged' | 'unstaged', boolean>) => void
  onStageFiles: (filePaths: string[]) => Promise<void>
  onStageFile: (filePath: string) => Promise<void>
  onUnstageFiles: (filePaths: string[]) => Promise<void>
  onUnstageFile: (filePath: string) => Promise<void>
  onWidthChange: (nextWidth: number) => void
  onWidthCommit?: (nextWidth: number) => void
  pendingFileActionPath: string | null
  sectionOpen: Record<'changes' | 'commit' | 'history' | 'staged' | 'unstaged', boolean>
  width: number
  workspacePath: string | null | undefined
}

const HISTORY_PAGE_SIZE = 200

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
  sectionOpen,
  width,
  workspacePath,
}: SourceControlPanelProps) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const panelBodyRef = useRef<HTMLDivElement | null>(null)
  const historyRowRefMap = useRef(new Map<string, HTMLButtonElement | null>())
  const commitActionControlsRef = useRef<HTMLDivElement | null>(null)
  const dragStateRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null)
  const resizeAnimationFrameRef = useRef<number | null>(null)
  const historyResizeStateRef = useRef<{
    containerHeight: number
    pointerId: number
    startHeight: number
    startY: number
  } | null>(null)
  const widthRef = useRef(width)
  const onWidthChangeRef = useRef(onWidthChange)
  const onWidthCommitRef = useRef(onWidthCommit)
  const [isResizing, setIsResizing] = useState(false)
  const [renderedWidth, setRenderedWidth] = useState(width)
  const [isHistoryResizing, setIsHistoryResizing] = useState(false)
  const [historyHeight, setHistoryHeight] = useState<number | null>(null)
  const [commitMessage, setCommitMessage] = useState('')
  const [isCommitActionMenuOpen, setIsCommitActionMenuOpen] = useState(false)
  const [operationNotice, setOperationNotice] = useState<SourceControlOperationNotice | null>(null)
  const [historyEntries, setHistoryEntries] = useState<GitHistoryEntry[]>([])
  const [headHash, setHeadHash] = useState<string | null>(null)
  const [hasMoreHistory, setHasMoreHistory] = useState(false)
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  const [isLoadingMoreHistory, setIsLoadingMoreHistory] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(null)
  const [expandedCommitHashes, setExpandedCommitHashes] = useState<string[]>([])
  const [commitDetailsByHash, setCommitDetailsByHash] = useState<Record<string, GitHistoryCommitDetailsResult>>({})
  const [loadingCommitHashes, setLoadingCommitHashes] = useState<string[]>([])
  const [isChangesSectionOpen, setIsChangesSectionOpen] = useState(sectionOpen.changes)
  const [isHistorySectionOpen, setIsHistorySectionOpen] = useState(sectionOpen.history)
  const [isStagedSectionOpen, setIsStagedSectionOpen] = useState(sectionOpen.staged)
  const [isUnstagedSectionOpen, setIsUnstagedSectionOpen] = useState(sectionOpen.unstaged)

  const normalizedWorkspacePath = workspacePath?.trim() ?? ''
  const hasWorkspacePath = normalizedWorkspacePath.length > 0
  const pendingState = useSourceControlPendingState(normalizedWorkspacePath)
  const pendingCommitOperation = pendingState?.commit ?? null
  const pendingSyncOperation = pendingState?.sync ?? null
  const previousPendingCommitOperationRef = useRef(pendingCommitOperation)
  const isSourceControlBusy = pendingCommitOperation !== null || pendingSyncOperation !== null
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
  const canQuickCommit = fileDiffs.length > 0 && !isSourceControlBusy
  const isCommitActionDisabled = !canQuickCommit || isSourceControlBusy
  const isQuickCommitting = pendingCommitOperation !== null
  const pendingSyncAction: GitSyncAction | 'refresh' | null = pendingSyncOperation?.action ?? null
  const isCommitPrimaryBusy = isQuickCommitting || pendingSyncAction === 'push'
  const isSyncingChanges = pendingSyncAction === 'sync'
  const pendingOperationLabel = pendingCommitOperation
    ? describeSourceControlPendingAction(pendingCommitOperation.action)
    : pendingSyncOperation
      ? describeSourceControlPendingAction(pendingSyncOperation.action)
      : null

  const historyViewModels = useMemo(() => computeSwimlanes(historyEntries), [historyEntries])

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
    widthRef.current = width
  }, [width])

  useEffect(() => {
    if (isResizing) {
      return
    }
    setRenderedWidth(width)
  }, [isResizing, width])

  useEffect(() => {
    onWidthChangeRef.current = onWidthChange
  }, [onWidthChange])

  useEffect(() => {
    onWidthCommitRef.current = onWidthCommit
  }, [onWidthCommit])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    function clampPanelWidth() {
      if (dragStateRef.current) {
        return
      }
      const parentWidth = panelRef.current?.parentElement?.clientWidth
      if (!parentWidth) {
        return
      }

      const clampedWidth = Math.min(getMaxDiffPanelWidth(parentWidth), Math.max(getMinDiffPanelWidth(parentWidth), renderedWidth))
      if (clampedWidth !== renderedWidth) {
        setRenderedWidth(clampedWidth)
        onWidthChangeRef.current(clampedWidth)
      }
    }

    clampPanelWidth()
    window.addEventListener('resize', clampPanelWidth)
    return () => window.removeEventListener('resize', clampPanelWidth)
  }, [isOpen, renderedWidth])

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const dragState = dragStateRef.current
      const parentWidth = panelRef.current?.parentElement?.clientWidth
      if (!dragState || !parentWidth) {
        return
      }

      const nextWidth = dragState.startWidth - (event.clientX - dragState.startX)
      const clampedWidth = Math.min(
        getMaxDiffPanelWidth(parentWidth),
        Math.max(getMinDiffPanelWidth(parentWidth), Math.round(nextWidth)),
      )
      widthRef.current = clampedWidth
      if (resizeAnimationFrameRef.current !== null) {
        return
      }

      resizeAnimationFrameRef.current = window.requestAnimationFrame(() => {
        resizeAnimationFrameRef.current = null
        setRenderedWidth(widthRef.current)
        if (panelRef.current) {
          panelRef.current.style.width = `${widthRef.current}px`
        }
      })
    }

    function handlePointerUp(event: PointerEvent) {
      if (dragStateRef.current?.pointerId !== event.pointerId) {
        return
      }

      dragStateRef.current = null
      if (resizeAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeAnimationFrameRef.current)
        resizeAnimationFrameRef.current = null
      }
      setRenderedWidth(widthRef.current)
      setIsResizing(false)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      onWidthChangeRef.current(widthRef.current)
      onWidthCommitRef.current?.(widthRef.current)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      if (resizeAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeAnimationFrameRef.current)
        resizeAnimationFrameRef.current = null
      }
      dragStateRef.current = null
      setIsResizing(false)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [])

  useEffect(() => {
    function handleHistoryPointerMove(event: PointerEvent) {
      const resizeState = historyResizeStateRef.current
      if (!resizeState) {
        return
      }

      const nextHeight = clampSourceControlHistoryHeight(
        resizeState.startHeight + (resizeState.startY - event.clientY),
        resizeState.containerHeight,
      )
      setHistoryHeight(nextHeight)
    }

    function handleHistoryPointerUp(event: PointerEvent) {
      if (historyResizeStateRef.current?.pointerId !== event.pointerId) {
        return
      }

      historyResizeStateRef.current = null
      setIsHistoryResizing(false)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }

    window.addEventListener('pointermove', handleHistoryPointerMove)
    window.addEventListener('pointerup', handleHistoryPointerUp)

    return () => {
      window.removeEventListener('pointermove', handleHistoryPointerMove)
      window.removeEventListener('pointerup', handleHistoryPointerUp)
      historyResizeStateRef.current = null
      setIsHistoryResizing(false)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [])

  useLayoutEffect(() => {
    if (!shouldUseSplitLayout || historyHeight !== null) {
      return
    }

    const containerHeight = panelBodyRef.current?.clientHeight
    if (!containerHeight) {
      return
    }

    setHistoryHeight(getDefaultSourceControlHistoryHeight(containerHeight))
  }, [historyHeight, shouldUseSplitLayout])

  useEffect(() => {
    const panelBody = panelBodyRef.current
    if (!panelBody) {
      return
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const containerHeight = entry.contentRect.height
        setHistoryHeight((currentValue) => {
          if (currentValue === null || !shouldUseSplitLayout) return currentValue
          const clamped = clampSourceControlHistoryHeight(currentValue, containerHeight)
          return clamped !== currentValue ? clamped : currentValue
        })
      }
    })

    observer.observe(panelBody)
    return () => observer.disconnect()
  }, [shouldUseSplitLayout])

  const loadHistoryPage = useCallback(
    async (offset: number, append: boolean) => {
      if (!hasWorkspacePath) {
        return
      }

      const result = await window.echosphereGit.getHistoryPage({
        limit: HISTORY_PAGE_SIZE,
        offset,
        workspacePath: normalizedWorkspacePath,
      })

      setHeadHash(result.headHash)
      setHasMoreHistory(result.hasMore)
      setHistoryEntries((currentEntries) => (append ? [...currentEntries, ...result.entries] : result.entries))
      setSelectedCommitHash((currentSelectedHash) => {
        if (currentSelectedHash && result.entries.some((entry) => entry.hash === currentSelectedHash)) {
          return currentSelectedHash
        }

        if (result.headHash && result.entries.some((entry) => entry.hash === result.headHash)) {
          return result.headHash
        }

        return result.entries[0]?.hash ?? null
      })
    },
    [hasWorkspacePath, normalizedWorkspacePath],
  )

  const refreshHistory = useCallback(async (options?: { silent?: boolean }) => {
    if (!hasWorkspacePath) {
      setHistoryEntries([])
      setHeadHash(null)
      setHasMoreHistory(false)
      setHistoryError(null)
      setSelectedCommitHash(null)
      setExpandedCommitHashes([])
      setCommitDetailsByHash({})
      setLoadingCommitHashes([])
      return
    }

    setHistoryError(null)
    if (!options?.silent) {
      setIsLoadingHistory(true)
    }
    try {
      await loadHistoryPage(0, false)
    } catch (error) {
      if (!options?.silent) {
        setHistoryEntries([])
        setHeadHash(null)
        setHasMoreHistory(false)
      }
      setHistoryError(error instanceof Error ? error.message : 'Failed to load git history.')
    } finally {
      if (!options?.silent) {
        setIsLoadingHistory(false)
      }
    }
  }, [hasWorkspacePath, loadHistoryPage])

  const appendCommittedHistoryEntry = useCallback(
    async (commitResult: GitCommitResult) => {
      if (!hasWorkspacePath) {
        return false
      }

      const nextEntry = commitResult.historyEntry
      if (nextEntry) {
        setHistoryEntries((currentValue) => prependCommittedHistoryEntry(currentValue, nextEntry))
        setHeadHash(nextEntry.hash)
        setSelectedCommitHash(nextEntry.hash)
        setHistoryError(null)
        return true
      }

      try {
        const result = await window.echosphereGit.getHistoryPage({
          limit: 1,
          offset: 0,
          workspacePath: normalizedWorkspacePath,
        })
        const nextEntry = result.entries[0]
        if (!nextEntry || nextEntry.hash !== commitResult.commitHash) {
          return false
        }

        setHistoryEntries((currentValue) => prependCommittedHistoryEntry(currentValue, nextEntry))
        setHeadHash(result.headHash)
        setSelectedCommitHash(nextEntry.hash)
        setHistoryError(null)
        return true
      } catch (error) {
        console.error('Failed to append the latest commit to the source control history.', error)
        return false
      }
    },
    [hasWorkspacePath, normalizedWorkspacePath],
  )

  const loadMoreHistory = useCallback(async () => {
    if (!hasWorkspacePath || !hasMoreHistory || isLoadingMoreHistory) {
      return
    }

    setIsLoadingMoreHistory(true)
    setHistoryError(null)
    try {
      await loadHistoryPage(historyEntries.length, true)
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'Failed to load more history.')
    } finally {
      setIsLoadingMoreHistory(false)
    }
  }, [hasMoreHistory, hasWorkspacePath, historyEntries.length, isLoadingMoreHistory, loadHistoryPage])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    void refreshHistory()
  }, [isOpen, refreshHistory, normalizedWorkspacePath])

  useEffect(() => {
    const handleFocus = () => {
      if (isOpen) {
        void refreshHistory({ silent: true })
      }
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [isOpen, refreshHistory])

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

  const loadCommitDetails = useCallback(
    async (commitHash: string) => {
      if (!hasWorkspacePath || commitDetailsByHash[commitHash] || loadingCommitHashes.includes(commitHash)) {
        return
      }

      setLoadingCommitHashes((currentValue) => [...currentValue, commitHash])
      try {
        const details = await window.echosphereGit.getHistoryCommitDetails({
          commitHash,
          workspacePath: normalizedWorkspacePath,
        })
        setCommitDetailsByHash((currentValue) => ({
          ...currentValue,
          [commitHash]: details,
        }))
      } catch (error) {
        setHistoryError(error instanceof Error ? error.message : 'Failed to load commit details.')
      } finally {
        setLoadingCommitHashes((currentValue) => currentValue.filter((value) => value !== commitHash))
      }
    },
    [commitDetailsByHash, hasWorkspacePath, loadingCommitHashes, normalizedWorkspacePath],
  )

  async function performSyncAction(action: GitSyncAction): Promise<boolean> {
    if (!hasWorkspacePath) {
      return false
    }

    const pendingSyncOperation = beginSourceControlSyncOperation(normalizedWorkspacePath, action)
    setOperationNotice(null)
    try {
      const result = await window.echosphereGit.sync({
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
        message: error instanceof Error ? error.message : `Failed to ${action}.`,
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
      setOperationNotice({ kind: 'success', message: 'Source control refreshed.' })
    } catch (error) {
      setOperationNotice({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Failed to refresh source control.',
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
        message: commitMessage,
      })

      if (commitResult) {
        await appendCommittedHistoryEntry(commitResult)
      }
      setCommitMessage('')
      if (action === 'commit-and-push') {
        const isPushSuccessful = await performSyncAction('push')
        if (!isPushSuccessful) {
          return
        }
      } else {
        setOperationNotice({ kind: 'success', message: 'Committed changes.' })
      }
    } catch (error) {
      setOperationNotice({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Failed to commit changes.',
      })
    }
  }

  async function handleGoToCurrentCommit() {
    if (!headHash) {
      return
    }

    if (!historyEntries.some((entry) => entry.hash === headHash) && hasMoreHistory) {
      await loadMoreHistory()
    }

    setSelectedCommitHash(headHash)
    requestAnimationFrame(() => {
      historyRowRefMap.current.get(headHash)?.scrollIntoView({
        block: 'center',
      })
    })
  }

  function handleResizePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return
    }

    dragStateRef.current = {
      pointerId: event.pointerId,
      startWidth: renderedWidth,
      startX: event.clientX,
    }

    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
    event.stopPropagation()
    setIsResizing(true)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
  }

  function handleHistoryResizePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return
    }

    if (!isHistorySectionOpen) {
      return
    }

    const containerHeight = panelBodyRef.current?.clientHeight
    if (!containerHeight) {
      return
    }

    const startHeight = historyHeight ?? getDefaultSourceControlHistoryHeight(containerHeight)
    historyResizeStateRef.current = {
      containerHeight,
      pointerId: event.pointerId,
      startHeight,
      startY: event.clientY,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
    event.stopPropagation()
    setHistoryHeight(startHeight)
    setIsHistoryResizing(true)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'row-resize'
  }

  function handleOpenDiffPanelForFile(filePath: string, scope: DiffPanelScope) {
    onDiffPanelSelectedScopeChange(scope)
    onDiffPanelExpandedFilePathsChange([filePath])
    onOpenDiffPanel()
  }

  function handleCommitExpandedToggle(commitHash: string) {
    const shouldExpand = !expandedCommitHashes.includes(commitHash)
    setSelectedCommitHash(commitHash)
    setExpandedCommitHashes((currentValue) =>
      shouldExpand ? [...currentValue, commitHash] : currentValue.filter((value) => value !== commitHash),
    )

    if (shouldExpand) {
      void loadCommitDetails(commitHash)
    }
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
        'relative hidden h-full shrink-0 overflow-hidden md:flex',
      ].join(' ')}
      style={{ width: `${renderedWidth}px` }}
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
            isOperationInProgress={isSourceControlBusy}
            isChangesSectionOpen={isChangesSectionOpen}
            isCommitActionDisabled={isCommitActionDisabled}
            isCommitActionMenuOpen={isCommitActionMenuOpen}
            isCommitPrimaryBusy={isCommitPrimaryBusy}
            isQuickCommitting={isQuickCommitting}
            isSyncingChanges={isSyncingChanges}
            isStagedSectionOpen={isStagedSectionOpen}
            isUnstagedSectionOpen={isUnstagedSectionOpen}
            hasRemote={hasRemote}
            operationNotice={operationNotice}
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
            isOperationInProgress={isSourceControlBusy}
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


function SourceControlPanelGate(props: SourceControlPanelProps) {
  if (!props.isOpen) {
    return null
  }

  return <SourceControlPanelContent {...props} />
}

export const SourceControlPanel = memo(SourceControlPanelGate)
