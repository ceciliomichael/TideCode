import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Maximize, Minimize } from 'lucide-react'
import { useFloatingMenuPosition } from '../../hooks/useFloatingMenuPosition'
import type { ConversationFileDiff } from '../../lib/chatDiffs'
import { getMaxDiffPanelWidth, getMinDiffPanelWidth } from '../../lib/diffPanelSizing'
import { Tooltip } from '../Tooltip'
import { VirtualizedConversationDiffFileList } from './VirtualizedConversationDiffFileList'

interface ConversationDiffPanelProps {
  currentBranch: string | null
  expandedFilePaths: readonly string[]
  fileDiffs: readonly ConversationFileDiff[]
  isOpen: boolean
  onDiscardFile: (filePath: string) => Promise<void>
  onExpandedFilePathsChange: (nextFilePaths: string[]) => void
  onScrollToFilePath?: () => void
  onStageFile: (filePath: string) => Promise<void>
  onUnstageFile: (filePath: string) => Promise<void>
  onSelectedScopeChange: (nextScope: DiffPanelScope) => void
  onWidthChange: (nextWidth: number) => void
  onWidthCommit?: (nextWidth: number) => void
  pendingFileActionPath: string | null
  scrollToFilePath?: string | null
  selectedScope: DiffPanelScope
  width: number
}

export type DiffPanelScope = 'branch' | 'last_turn' | 'staged' | 'unstaged'

interface DiffScopeOption {
  description: string | null
  label: string
  value: DiffPanelScope
}

function ConversationDiffPanelContent({
  currentBranch,
  expandedFilePaths,
  fileDiffs,
  isOpen,
  onDiscardFile,
  onExpandedFilePathsChange,
  onScrollToFilePath,
  onStageFile,
  onUnstageFile,
  onSelectedScopeChange,
  onWidthChange,
  onWidthCommit,
  pendingFileActionPath,
  scrollToFilePath,
  selectedScope,
  width,
}: ConversationDiffPanelProps) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const scopeContainerRef = useRef<HTMLDivElement | null>(null)
  const scopeButtonRef = useRef<HTMLButtonElement | null>(null)
  const scopeMenuRef = useRef<HTMLDivElement | null>(null)
  const [isResizing, setIsResizing] = useState(false)
  const [renderedWidth, setRenderedWidth] = useState(width)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isScopeMenuOpen, setIsScopeMenuOpen] = useState(false)
  const [highlightedScope, setHighlightedScope] = useState<DiffPanelScope>('unstaged')
  const dragStateRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null)
  const resizeAnimationFrameRef = useRef<number | null>(null)
  const widthRef = useRef(width)
  const onWidthChangeRef = useRef(onWidthChange)
  const onWidthCommitRef = useRef(onWidthCommit)
  const menuStyle = useFloatingMenuPosition({
    anchorRef: scopeButtonRef,
    isOpen: isScopeMenuOpen,
    menuRef: scopeMenuRef,
  })

  const branchLabel = currentBranch ? `${currentBranch} → origin/${currentBranch}` : 'No branch selected'
  const displayedFileDiffs = useMemo(() => {
    if (selectedScope === 'staged') {
      return fileDiffs.filter((fileDiff) => fileDiff.isStaged)
    }

    if (selectedScope === 'unstaged') {
      return fileDiffs.filter((fileDiff) => fileDiff.isUnstaged || fileDiff.isUntracked || (!fileDiff.isStaged && !fileDiff.isUnstaged && !fileDiff.isUntracked))
    }

    return fileDiffs
  }, [fileDiffs, selectedScope])
  const selectedScopeLabel =
    selectedScope === 'unstaged'
      ? 'Unstaged'
      : selectedScope === 'staged'
        ? 'Staged'
        : selectedScope === 'branch'
          ? 'Branch'
          : 'Last turn'
  const unstagedFileCount = useMemo(
    () => fileDiffs.filter((fileDiff) => fileDiff.isUnstaged || fileDiff.isUntracked || (!fileDiff.isStaged && !fileDiff.isUnstaged && !fileDiff.isUntracked)).length,
    [fileDiffs],
  )
  const stagedFileCount = useMemo(() => fileDiffs.filter((fileDiff) => fileDiff.isStaged).length, [fileDiffs])
  const selectedScopeCount = selectedScope === 'unstaged' ? unstagedFileCount : selectedScope === 'staged' ? stagedFileCount : null
  const expandedFilePathSet = useMemo(() => new Set(expandedFilePaths), [expandedFilePaths])

  const panelIconButtonClassName =
    'inline-flex h-6 w-6 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent'

  const scopeOptions = useMemo(
    () =>
      [
        {
          description: `${unstagedFileCount}`,
          label: 'Unstaged',
          value: 'unstaged',
        },
        {
          description: `${stagedFileCount}`,
          label: 'Staged',
          value: 'staged',
        },
        {
          description: branchLabel,
          label: 'Branch',
          value: 'branch',
        },
        {
          description: null,
          label: 'Last turn',
          value: 'last_turn',
        },
      ] satisfies readonly DiffScopeOption[],
    [branchLabel, stagedFileCount, unstagedFileCount],
  )

  useEffect(() => {
    widthRef.current = width
  }, [width])

  useLayoutEffect(() => {
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
    if (isOpen) {
      return
    }

    setIsFullscreen(false)
    setIsScopeMenuOpen(false)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    function preventDocumentSelectAll(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'a') {
        return
      }

      const target = event.target
      if (!(target instanceof Element)) {
        event.preventDefault()
        return
      }

      if (target.closest('input, textarea, [contenteditable="true"]')) {
        return
      }

      const diffContent = target.closest('[data-diff-content="true"]')
      if (diffContent && panelRef.current?.contains(diffContent)) {
        return
      }

      event.preventDefault()
    }

    document.addEventListener('keydown', preventDocumentSelectAll, true)
    return () => {
      document.removeEventListener('keydown', preventDocumentSelectAll, true)
    }
  }, [isOpen])

  useLayoutEffect(() => {
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
    if (!isScopeMenuOpen) {
      return
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target
      if (
        target instanceof Node &&
        !scopeContainerRef.current?.contains(target) &&
        !scopeMenuRef.current?.contains(target)
      ) {
        setIsScopeMenuOpen(false)
      }
    }

    window.addEventListener('mousedown', handlePointerDown)
    return () => window.removeEventListener('mousedown', handlePointerDown)
  }, [isScopeMenuOpen])

  useEffect(() => {
    if (!isScopeMenuOpen) {
      return
    }

    setHighlightedScope(selectedScope)
  }, [isScopeMenuOpen, selectedScope])

  useEffect(() => {
    const availableFilePathSet = new Set(fileDiffs.map((fileDiff) => fileDiff.fileName))
    const nextExpandedFilePaths = expandedFilePaths.filter((filePath) => availableFilePathSet.has(filePath))
    if (nextExpandedFilePaths.length !== expandedFilePaths.length) {
      onExpandedFilePathsChange(nextExpandedFilePaths)
    }
  }, [expandedFilePaths, fileDiffs, onExpandedFilePathsChange])

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

  function handleSelectScope(nextScope: DiffPanelScope) {
    onSelectedScopeChange(nextScope)
    setIsScopeMenuOpen(false)
  }

  function handleFileExpandedChange(fileName: string, isExpanded: boolean) {
    if (isExpanded) {
      if (expandedFilePathSet.has(fileName)) {
        return
      }

      onExpandedFilePathsChange([...expandedFilePaths, fileName])
      return
    }

    if (!expandedFilePathSet.has(fileName)) {
      return
    }

    onExpandedFilePathsChange(expandedFilePaths.filter((existingFileName) => existingFileName !== fileName))
  }

  function renderScopeOption(option: DiffScopeOption) {
    const isSelected = option.value === selectedScope
    const isHighlighted = option.value === highlightedScope

    return (
      <button
        key={option.value}
        type="button"
        role="option"
        aria-selected={isSelected}
        onMouseEnter={() => setHighlightedScope(option.value)}
        onClick={() => handleSelectScope(option.value)}
        className={[
          'flex w-full items-start justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition-[background-color,color,box-shadow]',
          isHighlighted
            ? 'bg-[var(--dropdown-option-active-surface)] text-foreground shadow-sm'
            : 'text-foreground hover:bg-[var(--dropdown-option-active-surface)]',
        ].join(' ')}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] leading-5">{option.label}</span>
          {option.description ? (
            <span className="mt-0.5 block truncate text-[11px] font-medium text-muted-foreground">{option.description}</span>
          ) : null}
        </span>
        {isSelected ? <Check size={16} strokeWidth={2.2} className="mt-0.5 shrink-0 text-brand" /> : null}
      </button>
    )
  }

  const isFullscreenPanel = isFullscreen && isOpen

  return (
    <div
      ref={panelRef}
      className={[
        isFullscreenPanel
          ? 'pointer-events-auto absolute inset-0 z-30 flex h-full min-w-0 overflow-hidden'
          : [
              'relative flex h-full min-w-0 shrink-0 overflow-hidden max-md:hidden',
              isOpen ? 'pointer-events-auto' : 'pointer-events-none invisible',
            ].join(' '),
      ].join(' ')}
      aria-hidden={!isOpen}
      style={isFullscreenPanel ? undefined : { width: isOpen ? `${renderedWidth}px` : '0px' }}
    >
      {!isFullscreen && isOpen ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize diff panel"
          onPointerDown={handleResizePointerDown}
          className="absolute inset-y-0 left-0 z-20 w-3 -translate-x-1/2 cursor-col-resize"
        />
      ) : null}

      <aside className="non-selectable-ui flex h-full min-w-0 flex-1 flex-col border-l border-border bg-[var(--workspace-panel-surface)]">
        <div className="flex h-14 shrink-0 items-center justify-between px-4">
          <div ref={scopeContainerRef} className="relative w-fit max-w-full">
            <button
              ref={scopeButtonRef}
              type="button"
              aria-haspopup="listbox"
              aria-expanded={isScopeMenuOpen}
              data-open={isScopeMenuOpen ? 'true' : 'false'}
              onClick={() => setIsScopeMenuOpen((currentValue) => !currentValue)}
              className="inline-flex h-8 items-center gap-2 text-sm text-foreground transition-colors hover:text-muted-foreground"
            >
              <span className="font-semibold">{selectedScopeLabel}</span>
              {selectedScopeCount !== null ? (
                <span className="text-sm font-semibold text-muted-foreground">{selectedScopeCount}</span>
              ) : null}
              <ChevronDown
                size={14}
                className={['text-muted-foreground transition-transform duration-200', isScopeMenuOpen ? 'rotate-180' : ''].join(
                  ' ',
                )}
              />
            </button>

            {isScopeMenuOpen
              ? createPortal(
                  <div
                    ref={scopeMenuRef}
                    data-floating-menu-root="true"
                    className="non-selectable-ui fixed z-40 w-[min(18rem,calc(100vw-1rem))] min-w-[10rem] overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-soft"
                    style={menuStyle}
                  >
                    <div
                      role="listbox"
                      aria-label="Diff scopes"
                      onMouseLeave={() => setHighlightedScope(selectedScope)}
                      className="max-h-56 space-y-0.5 overflow-y-auto"
                    >
                      {scopeOptions.map((option) => renderScopeOption(option))}
                    </div>
                  </div>,
                  document.body,
                )
              : null}
          </div>

          <Tooltip content={isFullscreen ? 'Exit fullscreen diff panel' : 'Fullscreen diff panel'} side="left" noWrap>
            <button
              type="button"
              aria-label={isFullscreen ? 'Exit fullscreen diff panel' : 'Fullscreen diff panel'}
              onClick={() => setIsFullscreen((currentValue) => !currentValue)}
              className={panelIconButtonClassName}
            >
              {isFullscreen ? <Minimize size={14} /> : <Maximize size={14} />}
            </button>
          </Tooltip>
        </div>

        <div className="h-px w-full bg-border" />

        {displayedFileDiffs.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-4 text-sm text-muted-foreground">
            {selectedScope === 'staged'
              ? 'No staged file diffs available.'
              : 'No changed files were detected for this branch.'}
          </div>
        ) : (
          <VirtualizedConversationDiffFileList
            diffs={displayedFileDiffs}
            expandedFilePathSet={expandedFilePathSet}
            onPreloadDiff={async () => undefined}
            prewarmEnabled={false}
            onScrollToFilePath={onScrollToFilePath}
            onDiscardFile={onDiscardFile}
            onExpandedChange={handleFileExpandedChange}
            onStageFile={onStageFile}
            onUnstageFile={onUnstageFile}
            pendingFileActionPath={pendingFileActionPath}
            scrollToFilePath={scrollToFilePath}
            selectedScope={selectedScope}
          />
        )}
      </aside>
    </div>
  )
}

export function ConversationDiffPanel(props: ConversationDiffPanelProps) {
  return <ConversationDiffPanelContent {...props} />
}
