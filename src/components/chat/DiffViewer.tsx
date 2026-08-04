import { memo, useEffect, useMemo, useState, useRef, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { useHighlightedCodeLines } from '../../hooks/useHighlightedCodeLines'
import { resolveFileIconConfig } from '../../lib/fileIconResolver'
import { computeDiffLines, type DiffLine } from '../../lib/textDiff'
import { PathLabel } from './PathLabel'
// eslint-disable-next-line react-refresh/only-export-components
export { calculateVisibleDiffRange } from './diffViewerVirtualization'
import { HighlightedCodeTokens } from './HighlightedCodeLine'
import type { HighlightedCodeLine as HighlightedCodeLineData } from '../../lib/codeHighlighting'

interface DiffViewerProps {
  className?: string
  collapsible?: boolean
  contextLines?: number
  defaultExpanded?: boolean
  diffCacheKey?: string
  filePath: string
  headerClassName?: string
  headerInlineContent?: ReactNode
  headerRightContent?: ReactNode
  headerTrailingContent?: ReactNode
  isExpanded?: boolean
  isStreaming?: boolean
  layout?: 'card' | 'stacked'
  maxBodyHeightClassName?: string
  newContent: string
  onExpandedChange?: (nextValue: boolean) => void
  oldContent: string | null | undefined
  startLineNumber?: number
  viewOnly?: boolean
}

function areDiffViewerPropsEqual(left: DiffViewerProps, right: DiffViewerProps) {
  return (
    left.className === right.className &&
    left.collapsible === right.collapsible &&
    left.contextLines === right.contextLines &&
    left.defaultExpanded === right.defaultExpanded &&
    left.diffCacheKey === right.diffCacheKey &&
    left.filePath === right.filePath &&
    left.headerClassName === right.headerClassName &&
    left.headerInlineContent === right.headerInlineContent &&
    left.headerRightContent === right.headerRightContent &&
    left.headerTrailingContent === right.headerTrailingContent &&
    left.isExpanded === right.isExpanded &&
    left.isStreaming === right.isStreaming &&
    left.layout === right.layout &&
    left.maxBodyHeightClassName === right.maxBodyHeightClassName &&
    left.newContent === right.newContent &&
    left.onExpandedChange === right.onExpandedChange &&
    left.oldContent === right.oldContent &&
    left.startLineNumber === right.startLineNumber &&
    left.viewOnly === right.viewOnly
  )
}

interface DiffViewerBodyProps {
  contextLines: number
  diffCacheKey?: string
  filePath: string
  hasOldSide: boolean
  isStreaming: boolean
  isStackedLayout: boolean
  newContent: string
  oldContent: string | null | undefined
  maxBodyHeightClassName?: string
  shouldRenderDiffContent: boolean
  startLineNumber: number
  viewOnly: boolean
}

const DEFAULT_DIFF_CONTEXT_LINES = 5
const DIFF_PLAIN_TEXT_RENDER_THRESHOLD = 240
const DIFF_PLAIN_TEXT_CHAR_THRESHOLD = 18000
const DIFF_CONTENT_VISIBILITY_THRESHOLD = 120

interface VisibleDiffLineItem {
  key: string
  line: DiffLine
  tokens: HighlightedCodeLineData['tokens']
}

interface DiffRowRenderProps {
  className?: string
  lineContent: ReactNode
  shouldUseContentVisibility: boolean
}

function DiffRowRender({ className, lineContent, shouldUseContentVisibility }: DiffRowRenderProps) {
  return (
    <div
      className={className}
      style={
        shouldUseContentVisibility
          ? {
              contain: 'layout paint style',
              contentVisibility: 'auto',
              containIntrinsicSize: '20px',
            }
          : undefined
      }
    >
      {lineContent}
    </div>
  )
}

const diffLinesCache = new Map<string, DiffLine[]>()
const MAX_DIFF_LINES_CACHE_ENTRIES = 24

function getCachedDiffLines(cacheKey: string) {
  return diffLinesCache.get(cacheKey)
}

function setCachedDiffLines(cacheKey: string, diffLines: DiffLine[]) {
  if (diffLinesCache.has(cacheKey)) {
    diffLinesCache.delete(cacheKey)
  }

  diffLinesCache.set(cacheKey, diffLines)
  while (diffLinesCache.size > MAX_DIFF_LINES_CACHE_ENTRIES) {
    const oldestKey = diffLinesCache.keys().next().value as string | undefined
    if (!oldestKey) {
      break
    }

    diffLinesCache.delete(oldestKey)
  }
}

function filterDiffWithContext(diffLines: DiffLine[], contextLines: number | undefined) {
  if (contextLines === undefined) {
    return diffLines
  }

  const changedIndices = new Set<number>()
  diffLines.forEach((line, index) => {
    if (line.type === 'added' || line.type === 'removed') {
      changedIndices.add(index)
    }
  })

  if (changedIndices.size === 0) {
    return diffLines
  }

  const includedIndices = new Set<number>()
  changedIndices.forEach((index) => {
    for (
      let currentIndex = Math.max(0, index - contextLines);
      currentIndex <= Math.min(diffLines.length - 1, index + contextLines);
      currentIndex += 1
    ) {
      includedIndices.add(currentIndex)
    }
  })

  const result: DiffLine[] = []
  let index = 0

  while (index < diffLines.length) {
    if (includedIndices.has(index)) {
      result.push(diffLines[index])
      index += 1
      continue
    }

    const collapsedStart = index
    while (index < diffLines.length && !includedIndices.has(index)) {
      index += 1
    }

    result.push({
      collapsedCount: index - collapsedStart,
      content: '',
      lineNumber: null,
      type: 'collapsed',
    })
  }

  return result
}

function getLineContentClassName(line: DiffLine, viewOnly: boolean) {
  if (viewOnly || line.type === 'unchanged') {
    return 'bg-transparent text-foreground'
  }

  if (line.type === 'added') {
    return 'bg-emerald-500/18 text-emerald-950 dark:bg-emerald-500/24 dark:text-emerald-50'
  }

  if (line.type === 'removed') {
    return 'bg-red-500/18 text-red-950 dark:bg-red-500/24 dark:text-red-50'
  }

  return 'bg-transparent text-foreground'
}

function getLineGutterClassName() {
  return 'bg-surface text-muted-foreground'
}

function getLineNumberDividerClassName() {
  return 'bg-border/80'
}

function getDiffRowClassName() {
  return 'grid min-h-5 grid-cols-[5.5rem_minmax(0,1fr)] items-stretch'
}

function getDiffGutterCellClassName() {
  return 'diff-viewer-gutter sticky left-0 z-10 flex shrink-0 items-start border-r border-border bg-surface px-2 text-right'
}

function getDiffContentCellClassName(line: DiffLine, viewOnly: boolean) {
  return `diff-viewer-content-row min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere] ${getLineContentClassName(line, viewOnly)}`
}

function getLineTokens(
  line: DiffLine,
  oldLines: readonly HighlightedCodeLineData[],
  newLines: readonly HighlightedCodeLineData[],
  startLineNumber: number,
) {
  const oldLineIndex = line.oldLineNumber === undefined ? null : line.oldLineNumber - startLineNumber
  const newLineIndex = line.newLineNumber === undefined ? null : line.newLineNumber - startLineNumber

  if (line.type === 'removed') {
    if (oldLineIndex === null || oldLineIndex < 0) {
      return []
    }

    return oldLines[oldLineIndex]?.tokens ?? []
  }

  if (line.type === 'added') {
    if (newLineIndex === null || newLineIndex < 0) {
      return []
    }

    return newLines[newLineIndex]?.tokens ?? []
  }

  if (newLineIndex === null || newLineIndex < 0) {
    return []
  }

  return newLines[newLineIndex]?.tokens ?? oldLines[newLineIndex]?.tokens ?? []
}

function HighlightedDiffRows({
  highlightedOldLines,
  highlightedNewLines,
  renderedLines,
  shouldUseContentVisibility,
  shouldUsePlainTextRendering,
  showsSingleLineNumberColumn,
  startLineNumber,
  viewOnly,
}: {
  highlightedOldLines: readonly HighlightedCodeLineData[]
  highlightedNewLines: readonly HighlightedCodeLineData[]
  renderedLines: readonly DiffLine[]
  shouldUseContentVisibility: boolean
  shouldUsePlainTextRendering: boolean
  showsSingleLineNumberColumn: boolean
  startLineNumber: number
  viewOnly: boolean
}) {
  const visibleLineItems = useMemo<VisibleDiffLineItem[]>(
    () =>
      renderedLines.map((line, index) => ({
        key: `${line.type}-${index}`,
        line,
        tokens: shouldUsePlainTextRendering ? [] : getLineTokens(line, highlightedOldLines, highlightedNewLines, startLineNumber),
      })),
    [highlightedNewLines, highlightedOldLines, renderedLines, shouldUsePlainTextRendering, startLineNumber],
  )

  return (
    <>
      {visibleLineItems.map(({ key, line, tokens }) => (
        <DiffRowRender
          key={key}
          className={getDiffRowClassName()}
          shouldUseContentVisibility={shouldUseContentVisibility}
          lineContent={
            <>
              <div className={`${getDiffGutterCellClassName()} ${getLineGutterClassName()}`}>
                {showsSingleLineNumberColumn ? (
                  <span className="select-none flex min-h-5 min-w-8 items-start justify-end leading-5">
                    {line.newLineNumber ?? ''}
                  </span>
                ) : (
                  <span className="select-none inline-grid grid-cols-[2rem_3px_2rem] items-start gap-0 leading-5">
                    <span className="flex min-h-5 min-w-8 items-start justify-end pr-1">
                      {line.oldLineNumber ?? ''}
                    </span>
                    <span className="flex min-h-5 items-stretch justify-center" aria-hidden="true">
                      <span className={`block h-full w-px ${getLineNumberDividerClassName()}`} />
                    </span>
                    <span className="flex min-h-5 min-w-8 items-start justify-end pl-1">
                      {line.newLineNumber ?? ''}
                    </span>
                  </span>
                )}
              </div>
              <div className={getDiffContentCellClassName(line, viewOnly)}>
                {tokens.length > 0 ? <HighlightedCodeTokens tokens={tokens} /> : line.content.length > 0 ? line.content : ' '}
              </div>
            </>
          }
        />
      ))}
    </>
  )
}

function PlainDiffRows({
  renderedLines,
  shouldUseContentVisibility,
  showsSingleLineNumberColumn,
  viewOnly,
}: {
  renderedLines: readonly DiffLine[]
  shouldUseContentVisibility: boolean
  showsSingleLineNumberColumn: boolean
  viewOnly: boolean
}) {
  return (
    <>
      {renderedLines.map((line, index) => (
        <DiffRowRender
          key={`row-${line.type}-${index}`}
          className={getDiffRowClassName()}
          shouldUseContentVisibility={shouldUseContentVisibility}
          lineContent={
            <>
              <div className={`${getDiffGutterCellClassName()} ${getLineGutterClassName()}`}>
                {showsSingleLineNumberColumn ? (
                  <span className="select-none flex min-h-5 min-w-8 items-start justify-end leading-5">
                    {line.newLineNumber ?? ''}
                  </span>
                ) : (
                  <span className="select-none inline-grid grid-cols-[2rem_3px_2rem] items-start gap-0 leading-5">
                    <span className="flex min-h-5 min-w-8 items-start justify-end pr-1">
                      {line.oldLineNumber ?? ''}
                    </span>
                    <span className="flex min-h-5 items-stretch justify-center" aria-hidden="true">
                      <span className={`block h-full w-px ${getLineNumberDividerClassName()}`} />
                    </span>
                    <span className="flex min-h-5 min-w-8 items-start justify-end pl-1">
                      {line.newLineNumber ?? ''}
                    </span>
                  </span>
                )}
              </div>
              <div className={getDiffContentCellClassName(line, viewOnly)}>{line.content.length > 0 ? line.content : ' '}</div>
            </>
          }
        />
      ))}
    </>
  )
}

function DiffViewerBody({
  contextLines,
  diffCacheKey,
  filePath,
  hasOldSide,
  isStreaming,
  isStackedLayout,
  newContent,
  oldContent,
  maxBodyHeightClassName,
  shouldRenderDiffContent,
  startLineNumber,
  viewOnly,
}: DiffViewerBodyProps) {
  const diffLinesCacheKey = diffCacheKey
    ? `${diffCacheKey}:${contextLines}:${isStreaming ? '1' : '0'}:${startLineNumber}`
    : null
  const diffLines = useMemo(() => {
    if (diffLinesCacheKey) {
      const cachedDiffLines = getCachedDiffLines(diffLinesCacheKey)
      if (cachedDiffLines) {
        return cachedDiffLines
      }
    }

    const diff = computeDiffLines(oldContent, newContent, { isStreaming, startLineNumber })
    const filteredDiffLines = filterDiffWithContext(diff, contextLines)
    if (diffLinesCacheKey) {
      setCachedDiffLines(diffLinesCacheKey, filteredDiffLines)
    }
    return filteredDiffLines
  }, [contextLines, diffLinesCacheKey, isStreaming, newContent, oldContent, startLineNumber])

  const renderedLines = useMemo(() => diffLines.filter((line) => line.type !== 'collapsed'), [diffLines])
  const plainTextLineCount = renderedLines.length
  const plainTextCharCount = useMemo(
    () => renderedLines.reduce((total, line) => total + line.content.length, 0),
    [renderedLines],
  )
  const shouldUsePlainTextRendering =
    plainTextLineCount >= DIFF_PLAIN_TEXT_RENDER_THRESHOLD || plainTextCharCount >= DIFF_PLAIN_TEXT_CHAR_THRESHOLD
  const highlightedOldLines = useHighlightedCodeLines(shouldUsePlainTextRendering ? '' : oldContent ?? '', {
    fileName: shouldUsePlainTextRendering ? 'text' : filePath,
    stripTrailingNewline: false,
  })
  const highlightedNewLines = useHighlightedCodeLines(shouldUsePlainTextRendering ? '' : newContent, {
    fileName: shouldUsePlainTextRendering ? 'text' : filePath,
    stripTrailingNewline: false,
  })
  const bodyHeightClassName = maxBodyHeightClassName ? `${maxBodyHeightClassName} overflow-y-auto` : ''
  const showsSingleLineNumberColumn = viewOnly || !hasOldSide
  const shouldUseContentVisibility = renderedLines.length >= DIFF_CONTENT_VISIBILITY_THRESHOLD
  const bodyRef = useRef<HTMLDivElement>(null)

  if (!shouldRenderDiffContent) {
    return null
  }

  return (
    <div
      ref={bodyRef}
      className={[
        isStackedLayout ? 'overflow-hidden bg-surface' : 'overflow-hidden rounded-b-2xl bg-surface',
        bodyHeightClassName,
        'overflow-x-auto',
      ]
        .filter((value) => value.length > 0)
        .join(' ')}
    >
      <div className="min-w-0 bg-surface font-mono text-[12px] leading-5">
        {shouldUsePlainTextRendering ? (
          <PlainDiffRows
            renderedLines={renderedLines}
            shouldUseContentVisibility={shouldUseContentVisibility}
            showsSingleLineNumberColumn={showsSingleLineNumberColumn}
            viewOnly={viewOnly}
          />
        ) : (
          <HighlightedDiffRows
            highlightedOldLines={highlightedOldLines}
            highlightedNewLines={highlightedNewLines}
            renderedLines={renderedLines}
            shouldUseContentVisibility={shouldUseContentVisibility}
            shouldUsePlainTextRendering={shouldUsePlainTextRendering}
            showsSingleLineNumberColumn={showsSingleLineNumberColumn}
            startLineNumber={startLineNumber}
            viewOnly={viewOnly}
          />
        )}
      </div>
    </div>
  )
}

const DiffViewerComponent = ({
  className,
  collapsible = false,
  contextLines = DEFAULT_DIFF_CONTEXT_LINES,
  defaultExpanded = true,
  diffCacheKey,
  filePath,
  headerClassName,
  headerInlineContent,
  headerRightContent,
  headerTrailingContent,
  isExpanded: expandedProp,
  isStreaming = false,
  layout = 'card',
  maxBodyHeightClassName,
  newContent,
  onExpandedChange,
  oldContent,
  startLineNumber = 1,
  viewOnly = false,
}: DiffViewerProps) => {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded)
  const shouldDeferBodyRender = collapsible
  const [isBodyReady, setIsBodyReady] = useState(!shouldDeferBodyRender || defaultExpanded)
  const isExpanded = expandedProp ?? internalExpanded
  const shouldRenderDiffContent = !collapsible || isExpanded
  const iconConfig = useMemo(() => resolveFileIconConfig({ fileName: filePath }), [filePath])
  const FileIcon = iconConfig.icon
  const headerMainContent = useMemo(
    () => (
      <span className="inline-flex min-h-4 min-w-0 flex-1 items-center gap-2">
        <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
          <FileIcon
            size={14}
            style={{ color: iconConfig.color }}
            aria-hidden="true"
            className={collapsible ? 'transition-opacity duration-150 group-hover:opacity-0 group-focus-visible:opacity-0' : ''}
          />
          {collapsible ? (
            <ChevronRight
              size={14}
              className={[
                'absolute inset-0 m-auto text-muted-foreground opacity-0 transition-[opacity,transform] duration-200 group-hover:opacity-100 group-focus-visible:opacity-100',
                isExpanded ? 'rotate-90' : '',
              ].join(' ')}
            />
          ) : null}
        </span>
        <span className="inline-flex min-w-0 items-center gap-2">
          <PathLabel path={filePath} className="min-w-0 leading-[1] text-foreground" />
          {headerInlineContent ? <span className="inline-flex shrink-0 items-center">{headerInlineContent}</span> : null}
          {headerTrailingContent ? <span className="inline-flex shrink-0 items-center">{headerTrailingContent}</span> : null}
        </span>
      </span>
    ),
    [FileIcon, collapsible, filePath, headerInlineContent, headerTrailingContent, iconConfig.color, isExpanded],
  )
  const hasRightHeaderContent = Boolean(headerRightContent)

  const isStackedLayout = layout === 'stacked'

  useEffect(() => {
    if (!shouldRenderDiffContent) {
      setIsBodyReady(false)
      return undefined
    }

    if (!shouldDeferBodyRender) {
      setIsBodyReady(true)
      return undefined
    }

    // Defer only the first render after expanding a file. Once the body is
    // visible, keep it mounted while new diff contents arrive so background
    // refreshes update in place instead of flashing "Rendering diff...".
    if (isBodyReady) {
      return undefined
    }

    let isCancelled = false
    setIsBodyReady(false)

    const frameId = window.requestAnimationFrame(() => {
      if (!isCancelled) {
        setIsBodyReady(true)
      }
    })

    return () => {
      isCancelled = true
      window.cancelAnimationFrame(frameId)
    }
  }, [
    contextLines,
    diffCacheKey,
    filePath,
    isExpanded,
    isStreaming,
    newContent,
    oldContent,
    shouldRenderDiffContent,
    shouldDeferBodyRender,
    startLineNumber,
    isBodyReady,
    viewOnly,
  ])

  return (
    <div
      className={[
        isStackedLayout
          ? 'my-0 w-full overflow-hidden rounded-none border-0 border-b border-border bg-surface shadow-none'
          : 'my-2 w-full overflow-hidden rounded-2xl border border-border bg-surface shadow-sm',
        className ?? '',
      ].join(' ')}
    >
      {collapsible ? (
        <div
          className={[
            'group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center bg-surface px-4 py-3 text-[12px] text-muted-foreground',
            isExpanded ? 'border-b border-border' : '',
            headerClassName ?? '',
          ].join(' ')}
        >
          <button
            type="button"
            aria-expanded={isExpanded}
            onClick={() => {
              const nextExpanded = !isExpanded
              if (expandedProp === undefined) {
                setInternalExpanded(nextExpanded)
              }
              onExpandedChange?.(nextExpanded)
            }}
            className="group flex min-w-0 w-full items-center text-left"
          >
            {headerMainContent}
          </button>
          {hasRightHeaderContent ? <span className="ml-3 inline-flex shrink-0 items-center">{headerRightContent}</span> : null}
        </div>
      ) : (
        <div
          className={[
            'grid w-full grid-cols-[minmax(0,1fr)_auto] items-center border-b border-border bg-surface px-4 py-3 text-[12px] text-muted-foreground',
            headerClassName ?? '',
          ].join(' ')}
        >
          {headerMainContent}
          {hasRightHeaderContent ? <span className="ml-3 inline-flex shrink-0 items-center">{headerRightContent}</span> : null}
        </div>
      )}

      {shouldRenderDiffContent ? (
        isBodyReady ? (
        <DiffViewerBody
          contextLines={contextLines}
          diffCacheKey={diffCacheKey}
          filePath={filePath}
          hasOldSide={!viewOnly && oldContent != null}
          isStreaming={isStreaming}
          isStackedLayout={isStackedLayout}
          newContent={newContent}
          oldContent={oldContent}
          maxBodyHeightClassName={maxBodyHeightClassName}
          shouldRenderDiffContent={shouldRenderDiffContent}
          startLineNumber={startLineNumber}
          viewOnly={viewOnly}
        />
        ) : (
          <div
            className={[
              isStackedLayout ? 'overflow-hidden bg-surface' : 'overflow-hidden rounded-b-2xl bg-surface',
              maxBodyHeightClassName ? `${maxBodyHeightClassName} overflow-y-auto` : '',
              'overflow-x-auto',
            ]
              .filter((value) => value.length > 0)
              .join(' ')}
          >
            <div className="flex min-h-20 items-center px-4 py-3 text-sm text-muted-foreground">
              Rendering diff...
            </div>
          </div>
        )
      ) : null}
    </div>
  )
}

export const DiffViewer = memo(DiffViewerComponent, areDiffViewerPropsEqual)
