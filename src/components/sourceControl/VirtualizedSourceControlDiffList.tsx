import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Minus, Plus, Undo2 } from 'lucide-react'
import type { ConversationFileDiff } from '../../lib/chatDiffs'
import { resolveFileIconConfig } from '../../lib/fileIconResolver'
import { getPathBasename } from '../../lib/pathPresentation'
import { PathLabel } from '../chat/PathLabel'
import { Tooltip } from '../Tooltip'
import type { DiffPanelScope } from '../chat/ConversationDiffFileItem'

interface VirtualizedSourceControlDiffListProps {
  bodyClassName?: string
  areFileActionsDisabled: boolean
  diffs: readonly ConversationFileDiff[]
  emptyLabel: string
  pendingFileActionPath: string | null
  selectedScope: DiffPanelScope
  onDiscardFile: (filePath: string) => Promise<void>
  onOpenDiffPanelForFile: (filePath: string, scope: DiffPanelScope) => void
  onStageFile: (filePath: string) => Promise<void>
  onUnstageFile: (filePath: string) => Promise<void>
}

interface VirtualizedDiffListRange {
  endIndex: number
  startIndex: number
}

interface DiffFileActionButtonsProps {
  diff: ConversationFileDiff
  areFileActionsDisabled: boolean
  isPending: boolean
  selectedScope: DiffPanelScope
  useTooltips: boolean
  onDiscardFile: (filePath: string) => Promise<void>
  onStageFile: (filePath: string) => Promise<void>
  onUnstageFile: (filePath: string) => Promise<void>
}

const DEFAULT_DELETED_DIFF_ROW_HEIGHT_PX = 56
const DEFAULT_DIFF_ROW_HEIGHT_PX = 49
const DIFF_LIST_OVERSCAN_PX = 320
const DIFF_LIST_VIRTUALIZATION_THRESHOLD = 24

function splitFilePath(path: string) {
  const normalizedPath = path.replace(/\\/g, '/')
  const fileName = getPathBasename(normalizedPath)

  if (fileName === normalizedPath) {
    return {
      directoryPath: '',
      fileName,
      normalizedPath,
    }
  }

  return {
    directoryPath: normalizedPath.slice(0, normalizedPath.length - fileName.length).replace(/\/$/u, ''),
    fileName,
    normalizedPath,
  }
}

function calculateVirtualizedDiffListRange(input: {
  itemHeights: readonly number[]
  offsets: readonly number[]
  scrollTop: number
  viewportHeight: number
}): VirtualizedDiffListRange {
  const minVisibleTop = Math.max(0, input.scrollTop - DIFF_LIST_OVERSCAN_PX)
  const maxVisibleBottom = input.scrollTop + input.viewportHeight + DIFF_LIST_OVERSCAN_PX
  let startIndex = 0

  while (startIndex < input.itemHeights.length && input.offsets[startIndex] + input.itemHeights[startIndex] < minVisibleTop) {
    startIndex += 1
  }

  let endIndex = startIndex
  while (endIndex < input.itemHeights.length && input.offsets[endIndex] < maxVisibleBottom) {
    endIndex += 1
  }

  return {
    endIndex,
    startIndex,
  }
}

function DiffFileActionButton({
  ariaLabel,
  className,
  content,
  disabled = false,
  icon,
  useTooltips,
  onClick,
}: {
  ariaLabel: string
  className: string
  content: string
  disabled?: boolean
  icon: JSX.Element
  useTooltips: boolean
  onClick: () => void
}) {
  const button = (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        if (!disabled) {
          onClick()
        }
      }}
      className={className}
    >
      {icon}
    </button>
  )

  if (!useTooltips || disabled) {
    return button
  }

  return (
    <Tooltip content={content} side="left" noWrap>
      {button}
    </Tooltip>
  )
}

function DiffLineSummary({ addedLineCount, removedLineCount }: { addedLineCount: number; removedLineCount: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs leading-none">
      <span className="leading-none text-emerald-600 dark:text-emerald-400">{`+${addedLineCount}`}</span>
      {removedLineCount > 0 ? <span className="leading-none text-red-600 dark:text-red-400">{`-${removedLineCount}`}</span> : null}
    </span>
  )
}

function DiffFileActionButtons({
  diff,
  areFileActionsDisabled,
  isPending,
  selectedScope,
  useTooltips,
  onDiscardFile,
  onStageFile,
  onUnstageFile,
}: DiffFileActionButtonsProps) {
  if (selectedScope === 'staged') {
    return (
      <span className="inline-flex min-w-[2.25rem] items-center justify-end gap-0.5">
        <DiffFileActionButton
          ariaLabel={`Unstage ${diff.fileName}`}
          className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          content="Unstage file"
          disabled={isPending || areFileActionsDisabled}
          icon={<Minus size={14} />}
          useTooltips={useTooltips}
          onClick={() => {
            void onUnstageFile(diff.fileName)
          }}
        />
      </span>
    )
  }

  return (
    <span className="inline-flex min-w-[4.5rem] items-center justify-end gap-0.5">
      <DiffFileActionButton
        ariaLabel={`Discard ${diff.fileName}`}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        content="Discard changes"
        disabled={isPending || areFileActionsDisabled}
        icon={<Undo2 size={14} />}
        useTooltips={useTooltips}
        onClick={() => {
          void onDiscardFile(diff.fileName)
        }}
      />
      <DiffFileActionButton
        ariaLabel={`Stage ${diff.fileName}`}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        content="Stage file"
        disabled={isPending || areFileActionsDisabled}
        icon={<Plus size={14} />}
        useTooltips={useTooltips}
        onClick={() => {
          void onStageFile(diff.fileName)
        }}
      />
    </span>
  )
}

function DiffRow({
  diff,
  areFileActionsDisabled,
  isPending,
  selectedScope,
  onDiscardFile,
  onOpenDiffPanelForFile,
  onStageFile,
  onUnstageFile,
}: {
  diff: ConversationFileDiff
  areFileActionsDisabled: boolean
  isPending: boolean
  selectedScope: DiffPanelScope
  onDiscardFile: (filePath: string) => Promise<void>
  onOpenDiffPanelForFile: (filePath: string, scope: DiffPanelScope) => void
  onStageFile: (filePath: string) => Promise<void>
  onUnstageFile: (filePath: string) => Promise<void>
}) {
  const iconConfig = resolveFileIconConfig({ fileName: diff.fileName })
  const FileIcon = iconConfig.icon
  const { normalizedPath } = splitFilePath(diff.fileName)

  return (
    <div
      className={[
        'group flex h-[49px] w-full items-center border-b border-border/60 bg-surface transition-colors',
        'hover:bg-surface-muted/50',
      ].join(' ')}
    >
      <button
        type="button"
        onClick={() => onOpenDiffPanelForFile(diff.fileName, selectedScope)}
        className="group flex min-w-0 flex-1 items-center px-4 py-3 text-left text-[12px] text-muted-foreground"
      >
        <span className="inline-flex min-h-4 min-w-0 flex-1 items-center gap-2.5">
          <FileIcon size={14} style={{ color: iconConfig.color }} className="shrink-0" />
          <span className="relative top-px inline-flex min-w-0 items-center gap-1.5">
              <PathLabel path={normalizedPath} className="min-w-0 leading-[1] text-foreground" />
              <DiffLineSummary addedLineCount={diff.addedLineCount} removedLineCount={diff.removedLineCount} />
          </span>
        </span>
      </button>
      <span className="ml-3 inline-flex w-[4.5rem] shrink-0 items-center justify-end pr-3">
        <DiffFileActionButtons
          diff={diff}
          areFileActionsDisabled={areFileActionsDisabled}
          isPending={isPending}
          selectedScope={selectedScope}
          useTooltips={false}
          onDiscardFile={onDiscardFile}
          onStageFile={onStageFile}
          onUnstageFile={onUnstageFile}
        />
      </span>
    </div>
  )
}

function DeletedDiffRow({
  diff,
  areFileActionsDisabled,
  isPending,
  selectedScope,
  onDiscardFile,
  onOpenDiffPanelForFile,
  onStageFile,
  onUnstageFile,
}: {
  diff: ConversationFileDiff
  areFileActionsDisabled: boolean
  isPending: boolean
  selectedScope: DiffPanelScope
  onDiscardFile: (filePath: string) => Promise<void>
  onOpenDiffPanelForFile: (filePath: string, scope: DiffPanelScope) => void
  onStageFile: (filePath: string) => Promise<void>
  onUnstageFile: (filePath: string) => Promise<void>
}) {
  const iconConfig = resolveFileIconConfig({ fileName: diff.fileName })
  const FileIcon = iconConfig.icon
  const { directoryPath, fileName, normalizedPath } = splitFilePath(diff.fileName)

  return (
    <div
      className={[
        'group flex min-h-[56px] w-full items-center border-b border-border/60 bg-surface transition-colors',
        'hover:bg-surface-muted/50',
      ].join(' ')}
    >
      <button
        type="button"
        onClick={() => onOpenDiffPanelForFile(diff.fileName, selectedScope)}
        className="group flex min-w-0 flex-1 items-center gap-2.5 px-4 py-2 text-left text-[12.5px] text-muted-foreground"
      >
        <FileIcon size={14} style={{ color: iconConfig.color }} className="shrink-0" />
        <Tooltip content={normalizedPath} side="top" noWrap triggerClassName="min-w-0 flex-1">
          <div className="min-w-0 flex-1">
            <div className="relative top-px inline-flex min-w-0 items-center gap-1.5">
              <span className="min-w-0 truncate text-left text-foreground decoration-white decoration-[1.5px] line-through">{fileName}</span>
              <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-red-500">D</span>
              <DiffLineSummary addedLineCount={diff.addedLineCount} removedLineCount={diff.removedLineCount} />
            </div>
            {directoryPath.length > 0 ? <div className="mt-0.5 truncate text-[11px] text-muted-foreground/80">{directoryPath}</div> : null}
          </div>
        </Tooltip>
      </button>
      <span className="ml-3 inline-flex w-[4.5rem] shrink-0 items-center justify-end pr-3">
        <DiffFileActionButtons
          diff={diff}
          areFileActionsDisabled={areFileActionsDisabled}
          isPending={isPending}
          selectedScope={selectedScope}
          useTooltips={false}
          onDiscardFile={onDiscardFile}
          onStageFile={onStageFile}
          onUnstageFile={onUnstageFile}
        />
      </span>
    </div>
  )
}

const rowWrapperStyle: CSSProperties = {
  left: 0,
  position: 'absolute',
  right: 0,
}

const MeasuredSourceControlDiffRow = memo(function MeasuredSourceControlDiffRow({
  diff,
  offsetTop,
  areFileActionsDisabled,
  pendingFileActionPath,
  selectedScope,
  onDiscardFile,
  onOpenDiffPanelForFile,
  onStageFile,
  onUnstageFile,
}: {
  diff: ConversationFileDiff
  offsetTop: number
  areFileActionsDisabled: boolean
  pendingFileActionPath: string | null
  selectedScope: DiffPanelScope
  onDiscardFile: (filePath: string) => Promise<void>
  onOpenDiffPanelForFile: (filePath: string, scope: DiffPanelScope) => void
  onStageFile: (filePath: string) => Promise<void>
  onUnstageFile: (filePath: string) => Promise<void>
}) {
  const isPending = pendingFileActionPath === diff.fileName

  return (
    <div style={{ ...rowWrapperStyle, top: `${offsetTop}px` }}>
      {diff.isDeleted ? (
        <DeletedDiffRow
          diff={diff}
          areFileActionsDisabled={areFileActionsDisabled}
          isPending={isPending}
          selectedScope={selectedScope}
          onDiscardFile={onDiscardFile}
          onOpenDiffPanelForFile={onOpenDiffPanelForFile}
          onStageFile={onStageFile}
          onUnstageFile={onUnstageFile}
        />
      ) : (
        <DiffRow
          diff={diff}
          areFileActionsDisabled={areFileActionsDisabled}
          isPending={isPending}
          selectedScope={selectedScope}
          onDiscardFile={onDiscardFile}
          onOpenDiffPanelForFile={onOpenDiffPanelForFile}
          onStageFile={onStageFile}
          onUnstageFile={onUnstageFile}
        />
      )}
    </div>
  )
})

export const VirtualizedSourceControlDiffList = memo(function VirtualizedSourceControlDiffList({
  bodyClassName,
  areFileActionsDisabled,
  diffs,
  emptyLabel,
  pendingFileActionPath,
  selectedScope,
  onDiscardFile,
  onOpenDiffPanelForFile,
  onStageFile,
  onUnstageFile,
}: VirtualizedSourceControlDiffListProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const shouldVirtualize = diffs.length >= DIFF_LIST_VIRTUALIZATION_THRESHOLD
  const itemHeights = useMemo(
    () => diffs.map((diff) => (diff.isDeleted ? DEFAULT_DELETED_DIFF_ROW_HEIGHT_PX : DEFAULT_DIFF_ROW_HEIGHT_PX)),
    [diffs],
  )
  const { offsets, totalHeight } = useMemo(() => {
    const nextOffsets: number[] = []
    let runningOffset = 0

    for (const itemHeight of itemHeights) {
      nextOffsets.push(runningOffset)
      runningOffset += itemHeight
    }

    return {
      offsets: nextOffsets,
      totalHeight: runningOffset,
    }
  }, [itemHeights])
  const visibleRange = useMemo(() => {
    if (!shouldVirtualize || viewportHeight <= 0) {
      return {
        endIndex: diffs.length,
        startIndex: 0,
      } satisfies VirtualizedDiffListRange
    }

    return calculateVirtualizedDiffListRange({
      itemHeights,
      offsets,
      scrollTop,
      viewportHeight,
    })
  }, [diffs.length, itemHeights, offsets, scrollTop, shouldVirtualize, viewportHeight])

  useEffect(() => {
    if (!scrollContainerRef.current) {
      return
    }

    let frameId: number | null = null

    function syncViewportMetrics() {
      const containerElement = scrollContainerRef.current
      if (!containerElement) {
        return
      }

      setViewportHeight((currentValue) =>
        currentValue === containerElement.clientHeight ? currentValue : containerElement.clientHeight,
      )
      setScrollTop((currentValue) => (currentValue === containerElement.scrollTop ? currentValue : containerElement.scrollTop))
    }

    function handleScroll() {
      if (frameId !== null) {
        return
      }

      frameId = window.requestAnimationFrame(() => {
        frameId = null
        syncViewportMetrics()
      })
    }

    syncViewportMetrics()
    const containerElement = scrollContainerRef.current
    if (!containerElement) {
      return
    }

    containerElement.addEventListener('scroll', handleScroll, { passive: true })

    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver === 'function') {
      observer = new ResizeObserver(() => {
        syncViewportMetrics()
      })
      observer.observe(containerElement)
    } else {
      window.addEventListener('resize', syncViewportMetrics)
    }

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
      }
      containerElement.removeEventListener('scroll', handleScroll)
      observer?.disconnect()
      if (observer === null) {
        window.removeEventListener('resize', syncViewportMetrics)
      }
    }
  }, [])

  return (
    <div ref={scrollContainerRef} className={bodyClassName ?? ''}>
      {diffs.length === 0 ? (
        <div className="flex min-h-16 items-center px-4 py-3">
          <p className="text-[12px] text-muted-foreground">{emptyLabel}</p>
        </div>
      ) : shouldVirtualize ? (
        <div style={{ height: `${totalHeight}px`, position: 'relative' }}>
          {diffs.slice(visibleRange.startIndex, visibleRange.endIndex).map((diff, index) => {
            const itemIndex = visibleRange.startIndex + index

            return (
              <MeasuredSourceControlDiffRow
                key={diff.fileName}
                diff={diff}
                offsetTop={offsets[itemIndex] ?? 0}
                areFileActionsDisabled={areFileActionsDisabled}
                pendingFileActionPath={pendingFileActionPath}
                selectedScope={selectedScope}
                onDiscardFile={onDiscardFile}
                onOpenDiffPanelForFile={onOpenDiffPanelForFile}
                onStageFile={onStageFile}
                onUnstageFile={onUnstageFile}
              />
            )
          })}
        </div>
      ) : (
        diffs.map((diff) =>
          diff.isDeleted ? (
            <DeletedDiffRow
              key={diff.fileName}
              diff={diff}
              areFileActionsDisabled={areFileActionsDisabled}
              isPending={pendingFileActionPath === diff.fileName}
              selectedScope={selectedScope}
              onDiscardFile={onDiscardFile}
              onOpenDiffPanelForFile={onOpenDiffPanelForFile}
              onStageFile={onStageFile}
              onUnstageFile={onUnstageFile}
            />
          ) : (
            <DiffRow
              key={diff.fileName}
              diff={diff}
              areFileActionsDisabled={areFileActionsDisabled}
              isPending={pendingFileActionPath === diff.fileName}
              selectedScope={selectedScope}
              onDiscardFile={onDiscardFile}
              onOpenDiffPanelForFile={onOpenDiffPanelForFile}
              onStageFile={onStageFile}
              onUnstageFile={onUnstageFile}
            />
          ),
        )
      )}
    </div>
  )
})
