import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { ConversationFileDiff } from '../../lib/chatDiffs'
import {
  calculateVariableSizeVirtualRange,
  resolveVirtualViewportHeight,
} from '../virtualization/variableSizeVirtualization'
import type { DiffPanelScope } from './ConversationDiffFileItem'
import { ConversationDiffFileItem } from './ConversationDiffFileItem'

interface VirtualizedConversationDiffFileListProps {
  diffs: readonly ConversationFileDiff[]
  expandedFilePathSet: ReadonlySet<string>
  onPreloadDiff: (diff: ConversationFileDiff) => Promise<void>
  prewarmEnabled: boolean
  onScrollToFilePath?: () => void
  onDiscardFile: (filePath: string) => Promise<void>
  onExpandedChange: (filePath: string, nextValue: boolean) => void
  onStageFile: (filePath: string) => Promise<void>
  onUnstageFile: (filePath: string) => Promise<void>
  pendingFileActionPath: string | null
  scrollToFilePath?: string | null
  selectedScope: DiffPanelScope
}

interface MeasuredConversationDiffRowProps {
  diff: ConversationFileDiff
  isExpanded: boolean
  offsetTop: number
  onDiscardFile: (filePath: string) => Promise<void>
  onExpandedChange: (filePath: string, nextValue: boolean) => void
  onHeightChange: (filePath: string, nextHeight: number) => void
  onPreloadDiff: (diff: ConversationFileDiff) => Promise<void>
  onPrewarmDiff: (filePath: string) => void
  onPrewarmReady: (filePath: string) => void
  onStageFile: (filePath: string) => Promise<void>
  onUnstageFile: (filePath: string) => Promise<void>
  pendingFileActionPath: string | null
  selectedScope: DiffPanelScope
  shouldPrewarm: boolean
}

const DEFAULT_COLLAPSED_DIFF_ROW_HEIGHT_PX = 49
const DEFAULT_EXPANDED_DIFF_ROW_HEIGHT_PX = 360
const DIFF_LIST_OVERSCAN_PX = 320
const DIFF_LIST_VIRTUALIZATION_THRESHOLD = 24

function scheduleDiffPrewarmTask(callback: () => void) {
  const idleWindow = window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
    cancelIdleCallback?: (handle: number) => void
  }
  if (idleWindow.requestIdleCallback) {
    const handle = idleWindow.requestIdleCallback(callback, { timeout: 350 })
    return () => idleWindow.cancelIdleCallback?.(handle)
  }

  const handle = window.setTimeout(callback, 32)
  return () => window.clearTimeout(handle)
}

function getEstimatedDiffRowHeight(isExpanded: boolean) {
  return isExpanded ? DEFAULT_EXPANDED_DIFF_ROW_HEIGHT_PX : DEFAULT_COLLAPSED_DIFF_ROW_HEIGHT_PX
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
  onPreloadDiff,
  onPrewarmDiff,
  onPrewarmReady,
  onStageFile,
  onUnstageFile,
  pendingFileActionPath,
  selectedScope,
  shouldPrewarm,
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
        onPreloadDiff={onPreloadDiff}
        onPrewarmDiff={onPrewarmDiff}
        onPrewarmReady={onPrewarmReady}
        onStageFile={onStageFile}
        onUnstageFile={onUnstageFile}
        pendingFileActionPath={pendingFileActionPath}
        selectedScope={selectedScope}
        shouldPrewarm={shouldPrewarm}
      />
    </div>
  )
})

export const VirtualizedConversationDiffFileList = memo(function VirtualizedConversationDiffFileList({
  diffs,
  expandedFilePathSet,
  onPreloadDiff,
  prewarmEnabled,
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
  const [prewarmFilePathSet, setPrewarmFilePathSet] = useState<ReadonlySet<string>>(new Set())
  const prewarmFilePathSetRef = useRef(new Set<string>())
  const prewarmQueueRef = useRef<string[]>([])
  const queuedPrewarmFilePathSetRef = useRef(new Set<string>())
  const activePrewarmFilePathRef = useRef<string | null>(null)
  const scheduledPrewarmTaskCancelRef = useRef<(() => void) | null>(null)

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
    if (!shouldVirtualize) {
      return {
        endIndex: diffs.length,
        startIndex: 0,
      }
    }

    return calculateVariableSizeVirtualRange({
      itemHeights,
      offsets,
      overscanPx: DIFF_LIST_OVERSCAN_PX,
      scrollTop,
      viewportHeight: resolveVirtualViewportHeight(viewportHeight),
    })
  }, [diffs.length, itemHeights, offsets, scrollTop, shouldVirtualize, viewportHeight])

  const visibleFilePathSet = useMemo(() => {
    const startIndex = shouldVirtualize ? visibleRange.startIndex : 0
    const endIndex = shouldVirtualize ? visibleRange.endIndex : diffs.length
    const visiblePaths = diffs.slice(startIndex, endIndex).map((diff) => diff.fileName)
    if (visiblePaths.length > 0 || diffs.length === 0) {
      return new Set(visiblePaths)
    }

    return new Set([diffs[0].fileName])
  }, [diffs, shouldVirtualize, visibleRange.endIndex, visibleRange.startIndex])

  const startNextPrewarm = useCallback(() => {
    if (!prewarmEnabled || activePrewarmFilePathRef.current !== null) {
      return
    }

    let nextFilePath: string | undefined
    while (prewarmQueueRef.current.length > 0 && !nextFilePath) {
      const queuedFilePath = prewarmQueueRef.current.shift()
      if (
        queuedFilePath &&
        visibleFilePathSet.has(queuedFilePath) &&
        !prewarmFilePathSetRef.current.has(queuedFilePath)
      ) {
        nextFilePath = queuedFilePath
      }
    }

    if (!nextFilePath) {
      nextFilePath = diffs.find(
        (diff) => visibleFilePathSet.has(diff.fileName) && !prewarmFilePathSetRef.current.has(diff.fileName),
      )?.fileName
    }

    if (!nextFilePath) {
      return
    }

    queuedPrewarmFilePathSetRef.current.delete(nextFilePath)
    activePrewarmFilePathRef.current = nextFilePath
    prewarmFilePathSetRef.current.add(nextFilePath)
    setPrewarmFilePathSet(new Set(prewarmFilePathSetRef.current))
  }, [diffs, prewarmEnabled, visibleFilePathSet])

  const requestPrewarm = useCallback(
    (filePath: string) => {
      if (
        !prewarmEnabled ||
        prewarmFilePathSetRef.current.has(filePath) ||
        queuedPrewarmFilePathSetRef.current.has(filePath)
      ) {
        return
      }

      queuedPrewarmFilePathSetRef.current.add(filePath)
      prewarmQueueRef.current.push(filePath)
      startNextPrewarm()
    },
    [prewarmEnabled, startNextPrewarm],
  )

  const handlePrewarmReady = useCallback(
    (filePath: string) => {
      if (activePrewarmFilePathRef.current !== filePath) {
        return
      }

      activePrewarmFilePathRef.current = null
      scheduledPrewarmTaskCancelRef.current?.()
      scheduledPrewarmTaskCancelRef.current = scheduleDiffPrewarmTask(() => {
        scheduledPrewarmTaskCancelRef.current = null
        startNextPrewarm()
      })
    },
    [startNextPrewarm],
  )

  useEffect(() => {
    if (!prewarmEnabled) {
      activePrewarmFilePathRef.current = null
      scheduledPrewarmTaskCancelRef.current?.()
      scheduledPrewarmTaskCancelRef.current = null
      prewarmQueueRef.current = []
      queuedPrewarmFilePathSetRef.current.clear()
      prewarmFilePathSetRef.current.clear()
      setPrewarmFilePathSet(new Set())
      return
    }

    startNextPrewarm()
  }, [prewarmEnabled, startNextPrewarm])

  useEffect(() => {
    const activeFilePath = activePrewarmFilePathRef.current
    if (!activeFilePath || visibleFilePathSet.has(activeFilePath)) {
      return
    }

    activePrewarmFilePathRef.current = null
    prewarmFilePathSetRef.current.delete(activeFilePath)
    setPrewarmFilePathSet(new Set(prewarmFilePathSetRef.current))
    startNextPrewarm()
  }, [startNextPrewarm, visibleFilePathSet])

  useEffect(() => {
    return () => {
      scheduledPrewarmTaskCancelRef.current?.()
      scheduledPrewarmTaskCancelRef.current = null
    }
  }, [])

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
                onPreloadDiff={onPreloadDiff}
                onPrewarmDiff={requestPrewarm}
                onPrewarmReady={handlePrewarmReady}
                onStageFile={onStageFile}
                onUnstageFile={onUnstageFile}
                pendingFileActionPath={pendingFileActionPath}
                selectedScope={selectedScope}
                shouldPrewarm={prewarmFilePathSet.has(diff.fileName)}
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
            onPreloadDiff={onPreloadDiff}
            onPrewarmDiff={requestPrewarm}
            onPrewarmReady={handlePrewarmReady}
            onStageFile={onStageFile}
            onUnstageFile={onUnstageFile}
            pendingFileActionPath={pendingFileActionPath}
            selectedScope={selectedScope}
            shouldPrewarm={prewarmFilePathSet.has(diff.fileName)}
          />
        ))
      )}
    </div>
  )
})
