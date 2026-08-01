import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { ConversationFileDiff } from '../../lib/chatDiffs'
import type { DiffPanelScope } from './ConversationDiffFileItem'
import { ConversationDiffFileItem } from './ConversationDiffFileItem'

interface VirtualizedConversationDiffFileListProps {
  diffs: readonly ConversationFileDiff[]
  expandedFilePathSet: ReadonlySet<string>
  onScrollToFilePath?: () => void
  onDiscardFile: (filePath: string) => Promise<void>
  onExpandedChange: (filePath: string, nextValue: boolean) => void
  onStageFile: (filePath: string) => Promise<void>
  onUnstageFile: (filePath: string) => Promise<void>
  pendingFileActionPath: string | null
  scrollToFilePath?: string | null
  selectedScope: DiffPanelScope
}

interface VirtualizedDiffListRange {
  endIndex: number
  startIndex: number
}

interface MeasuredConversationDiffRowProps {
  diff: ConversationFileDiff
  isExpanded: boolean
  offsetTop: number
  onDiscardFile: (filePath: string) => Promise<void>
  onExpandedChange: (filePath: string, nextValue: boolean) => void
  onHeightChange: (filePath: string, nextHeight: number) => void
  onStageFile: (filePath: string) => Promise<void>
  onUnstageFile: (filePath: string) => Promise<void>
  pendingFileActionPath: string | null
  selectedScope: DiffPanelScope
}

const DEFAULT_COLLAPSED_DIFF_ROW_HEIGHT_PX = 49
const DEFAULT_EXPANDED_DIFF_ROW_HEIGHT_PX = 360
const DIFF_LIST_OVERSCAN_PX = 320
const DIFF_LIST_VIRTUALIZATION_THRESHOLD = 24

function getEstimatedDiffRowHeight(isExpanded: boolean) {
  return isExpanded ? DEFAULT_EXPANDED_DIFF_ROW_HEIGHT_PX : DEFAULT_COLLAPSED_DIFF_ROW_HEIGHT_PX
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

  while (
    startIndex < input.itemHeights.length &&
    input.offsets[startIndex] + input.itemHeights[startIndex] < minVisibleTop
  ) {
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

const rowWrapperStyle: CSSProperties = {
  left: 0,
  position: 'absolute',
  right: 0,
}

const MeasuredConversationDiffRow = memo(function MeasuredConversationDiffRow({
  diff,
  isExpanded,
  offsetTop,
  onDiscardFile,
  onExpandedChange,
  onHeightChange,
  onStageFile,
  onUnstageFile,
  pendingFileActionPath,
  selectedScope,
}: MeasuredConversationDiffRowProps) {
  const rowRef = useRef<HTMLDivElement | null>(null)

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
        onHeightChange(diff.fileName, nextHeight)
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
  }, [diff.fileName, isExpanded, onHeightChange])

  return (
    <div ref={rowRef} style={{ ...rowWrapperStyle, top: `${offsetTop}px` }}>
      <ConversationDiffFileItem
        diff={diff}
        isExpanded={isExpanded}
        onDiscardFile={onDiscardFile}
        onExpandedChange={onExpandedChange}
        onStageFile={onStageFile}
        onUnstageFile={onUnstageFile}
        pendingFileActionPath={pendingFileActionPath}
        selectedScope={selectedScope}
      />
    </div>
  )
})

export const VirtualizedConversationDiffFileList = memo(function VirtualizedConversationDiffFileList({
  diffs,
  expandedFilePathSet,
  onScrollToFilePath,
  onDiscardFile,
  onExpandedChange,
  onStageFile,
  onUnstageFile,
  pendingFileActionPath,
  scrollToFilePath,
  selectedScope,
}: VirtualizedConversationDiffFileListProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [measuredHeightsByPath, setMeasuredHeightsByPath] = useState<Record<string, number>>({})

  const shouldVirtualize = diffs.length >= DIFF_LIST_VIRTUALIZATION_THRESHOLD
  const itemHeights = useMemo(
    () =>
      diffs.map((diff) => {
        const measuredHeight = measuredHeightsByPath[diff.fileName]
        return measuredHeight ?? getEstimatedDiffRowHeight(expandedFilePathSet.has(diff.fileName))
      }),
    [diffs, expandedFilePathSet, measuredHeightsByPath],
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
    if (!scrollToFilePath || !scrollContainerRef.current) {
      return
    }

    const targetIndex = diffs.findIndex((diff) => diff.fileName === scrollToFilePath)
    if (targetIndex < 0) {
      if (diffs.length > 0) {
        onScrollToFilePath?.()
      }
      return
    }

    const containerElement = scrollContainerRef.current
    const targetTop = offsets[targetIndex] ?? 0
    const nextScrollTop = targetTop > 0 ? targetTop - 8 : 0
    const maxScrollTop = Math.max(0, containerElement.scrollHeight - containerElement.clientHeight)
    const clampedScrollTop = Math.min(maxScrollTop, Math.max(0, nextScrollTop))

    if (containerElement.scrollTop !== clampedScrollTop) {
      containerElement.scrollTop = clampedScrollTop
      setScrollTop(clampedScrollTop)
    }

    onScrollToFilePath?.()
  }, [diffs, itemHeights, offsets, onScrollToFilePath, scrollToFilePath])

  const handleHeightChange = useCallback((filePath: string, nextHeight: number) => {
    setMeasuredHeightsByPath((currentValue) => {
      if (currentValue[filePath] === nextHeight) {
        return currentValue
      }

      return {
        ...currentValue,
        [filePath]: nextHeight,
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
    <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto">
      {shouldVirtualize ? (
        <div style={{ height: `${totalHeight}px`, position: 'relative' }}>
          {diffs.slice(visibleRange.startIndex, visibleRange.endIndex).map((diff, index) => {
            const itemIndex = visibleRange.startIndex + index

            return (
              <MeasuredConversationDiffRow
                key={diff.fileName}
                diff={diff}
                isExpanded={expandedFilePathSet.has(diff.fileName)}
                offsetTop={offsets[itemIndex] ?? 0}
                onDiscardFile={onDiscardFile}
                onExpandedChange={onExpandedChange}
                onHeightChange={handleHeightChange}
                onStageFile={onStageFile}
                onUnstageFile={onUnstageFile}
                pendingFileActionPath={pendingFileActionPath}
                selectedScope={selectedScope}
              />
            )
          })}
        </div>
      ) : (
        diffs.map((diff) => (
          <ConversationDiffFileItem
            key={diff.fileName}
            diff={diff}
            isExpanded={expandedFilePathSet.has(diff.fileName)}
            onDiscardFile={onDiscardFile}
            onExpandedChange={onExpandedChange}
            onStageFile={onStageFile}
            onUnstageFile={onUnstageFile}
            pendingFileActionPath={pendingFileActionPath}
            selectedScope={selectedScope}
          />
        ))
      )}
    </div>
  )
})
