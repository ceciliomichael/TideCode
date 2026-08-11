import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject } from 'react'
import { Loader2 } from 'lucide-react'
import type { GitHistoryCommitDetailsResult } from '../../types/chat'
import {
  calculateVariableSizeVirtualRange,
  resolveVirtualViewportHeight,
} from '../virtualization/variableSizeVirtualization'
import type { HistoryItemViewModel } from './historyGraphLayout'
import { SourceControlHistoryItem } from './SourceControlHistoryItem'

interface VirtualizedSourceControlHistoryListProps {
  bodyClassName?: string
  commitDetailsByHash: Readonly<Record<string, GitHistoryCommitDetailsResult>>
  expandedCommitHashes: readonly string[]
  hasMoreHistory: boolean
  historyError: string | null
  historyRowRefMap: MutableRefObject<Map<string, HTMLButtonElement | null>>
  historyViewModels: readonly HistoryItemViewModel[]
  isLoadingMoreHistory: boolean
  loadingCommitHashes: readonly string[]
  selectedCommitHash: string | null
  onLoadCommitDetails: (commitHash: string) => Promise<void>
  onLoadMoreHistory: () => Promise<void>
  onToggleCommitExpanded: (commitHash: string) => void
}

interface MeasuredSourceControlHistoryRowProps {
  commitDetails: GitHistoryCommitDetailsResult | undefined
  isExpanded: boolean
  isLoadingDetails: boolean
  isSelected: boolean
  offsetTop: number
  historyRowRefMap: MutableRefObject<Map<string, HTMLButtonElement | null>>
  viewModel: HistoryItemViewModel
  onHeightChange: (commitHash: string, nextHeight: number) => void
  onLoadCommitDetails: (commitHash: string) => Promise<void>
  onToggleCommitExpanded: (commitHash: string) => void
}

const DEFAULT_COLLAPSED_HISTORY_ROW_HEIGHT_PX = 50
const DEFAULT_EXPANDED_HISTORY_ROW_HEIGHT_PX = 260
const HISTORY_LIST_OVERSCAN_PX = 320
const HISTORY_LIST_VIRTUALIZATION_THRESHOLD = 24

const rowWrapperStyle: CSSProperties = {
  left: 0,
  position: 'absolute',
  right: 0,
}

const MeasuredSourceControlHistoryRow = memo(function MeasuredSourceControlHistoryRow({
  commitDetails,
  isExpanded,
  isLoadingDetails,
  isSelected,
  offsetTop,
  historyRowRefMap,
  viewModel,
  onHeightChange,
  onLoadCommitDetails,
  onToggleCommitExpanded,
}: MeasuredSourceControlHistoryRowProps) {
  const rowRef = useRef<HTMLDivElement | null>(null)
  const { entry } = viewModel

  useEffect(() => {
    if (!rowRef.current) {
      return
    }

    function syncHeight() {
      const rowElement = rowRef.current
      if (!rowElement) {
        return
      }

      const nextHeight = Math.ceil(rowElement.getBoundingClientRect().height)
      if (nextHeight > 0) {
        onHeightChange(entry.hash, nextHeight)
      }
    }

    syncHeight()

    if (typeof ResizeObserver !== 'function') {
      return
    }

    const observer = new ResizeObserver(() => {
      syncHeight()
    })

    observer.observe(rowRef.current)

    return () => {
      observer.disconnect()
    }
  }, [entry.hash, isExpanded, onHeightChange])

  return (
    <div ref={rowRef} style={{ ...rowWrapperStyle, top: `${offsetTop}px` }}>
      <SourceControlHistoryItem
        commitDetails={commitDetails}
        historyRowRefMap={historyRowRefMap}
        isExpanded={isExpanded}
        isLoadingDetails={isLoadingDetails}
        isSelected={isSelected}
        viewModel={viewModel}
        onLoadCommitDetails={onLoadCommitDetails}
        onToggleCommitExpanded={onToggleCommitExpanded}
      />
    </div>
  )
})

export const VirtualizedSourceControlHistoryList = memo(function VirtualizedSourceControlHistoryList({
  bodyClassName,
  commitDetailsByHash,
  expandedCommitHashes,
  hasMoreHistory,
  historyError,
  historyRowRefMap,
  historyViewModels,
  isLoadingMoreHistory,
  loadingCommitHashes,
  selectedCommitHash,
  onLoadCommitDetails,
  onLoadMoreHistory,
  onToggleCommitExpanded,
}: VirtualizedSourceControlHistoryListProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [measuredHeightsByHash, setMeasuredHeightsByHash] = useState<Record<string, number>>({})
  const expandedCommitHashSet = useMemo(() => new Set(expandedCommitHashes), [expandedCommitHashes])
  const shouldVirtualize = historyViewModels.length >= HISTORY_LIST_VIRTUALIZATION_THRESHOLD
  const itemHeights = useMemo(
    () =>
      historyViewModels.map((viewModel) => {
        const measuredHeight = measuredHeightsByHash[viewModel.entry.hash]
        return measuredHeight ?? (expandedCommitHashSet.has(viewModel.entry.hash)
          ? DEFAULT_EXPANDED_HISTORY_ROW_HEIGHT_PX
          : DEFAULT_COLLAPSED_HISTORY_ROW_HEIGHT_PX)
      }),
    [expandedCommitHashSet, historyViewModels, measuredHeightsByHash],
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
    if (!shouldVirtualize) {
      return {
        endIndex: historyViewModels.length,
        startIndex: 0,
      }
    }

    return calculateVariableSizeVirtualRange({
      itemHeights,
      offsets,
      overscanPx: HISTORY_LIST_OVERSCAN_PX,
      scrollTop,
      viewportHeight: resolveVirtualViewportHeight(viewportHeight),
    })
  }, [historyViewModels.length, itemHeights, offsets, scrollTop, shouldVirtualize, viewportHeight])

  const handleHeightChange = useCallback((commitHash: string, nextHeight: number) => {
    setMeasuredHeightsByHash((currentValue) => {
      if (currentValue[commitHash] === nextHeight) {
        return currentValue
      }

      return {
        ...currentValue,
        [commitHash]: nextHeight,
      }
    })
  }, [])

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
      {historyViewModels.length === 0 ? null : shouldVirtualize ? (
        <div style={{ height: `${totalHeight}px`, position: 'relative' }}>
          {historyViewModels.slice(visibleRange.startIndex, visibleRange.endIndex).map((viewModel, index) => {
            const itemIndex = visibleRange.startIndex + index
            const { entry } = viewModel
            const isExpanded = expandedCommitHashSet.has(entry.hash)
            const isSelected = selectedCommitHash === entry.hash

            return (
              <MeasuredSourceControlHistoryRow
                key={entry.hash}
                commitDetails={commitDetailsByHash[entry.hash]}
                historyRowRefMap={historyRowRefMap}
                isExpanded={isExpanded}
                isLoadingDetails={loadingCommitHashes.includes(entry.hash)}
                isSelected={isSelected}
                offsetTop={offsets[itemIndex] ?? 0}
                viewModel={viewModel}
                onHeightChange={handleHeightChange}
                onLoadCommitDetails={onLoadCommitDetails}
                onToggleCommitExpanded={onToggleCommitExpanded}
              />
            )
          })}
        </div>
      ) : (
        historyViewModels.map((viewModel) => {
          const { entry } = viewModel
          const isExpanded = expandedCommitHashSet.has(entry.hash)
          const isSelected = selectedCommitHash === entry.hash

          return (
            <SourceControlHistoryItem
              key={entry.hash}
              commitDetails={commitDetailsByHash[entry.hash]}
              historyRowRefMap={historyRowRefMap}
              isExpanded={isExpanded}
              isLoadingDetails={loadingCommitHashes.includes(entry.hash)}
              isSelected={isSelected}
              viewModel={viewModel}
              onLoadCommitDetails={onLoadCommitDetails}
              onToggleCommitExpanded={onToggleCommitExpanded}
            />
          )
        })
      )}

      {historyError ? <p className="px-4 py-2 text-xs text-danger-foreground">{historyError}</p> : null}

      {hasMoreHistory ? (
        <div className="px-4 py-3">
          <button
            type="button"
            disabled={isLoadingMoreHistory}
            onClick={() => void onLoadMoreHistory()}
            className="inline-flex h-8 w-full items-center justify-center rounded-xl border border-border bg-surface-muted/50 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoadingMoreHistory ? (
              <>
                <Loader2 size={13} className="mr-1.5 animate-spin" />
                Loading...
              </>
            ) : (
              'Load more commits'
            )}
          </button>
        </div>
      ) : null}
    </div>
  )
})
