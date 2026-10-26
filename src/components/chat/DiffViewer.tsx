import { lazy, memo, Suspense, useState, type ReactNode } from 'react'
import { DiffFileHeader } from './DiffFileHeader'
import type { ConversationFileDiff } from '../../lib/chatDiffs'
import { WorkspaceMonacoDiffLoadingView } from './diffViewer/WorkspaceMonacoDiffLoadingView'
import { estimateWorkspaceMonacoDiffHeight, resolveWorkspaceMonacoDiffMaxHeight } from './diffViewer/workspaceMonacoDiffConfig'
import { preloadWorkspaceMonacoDiffView } from '../../lib/workspaceMonacoPreload'

// eslint-disable-next-line react-refresh/only-export-components
export { calculateVisibleDiffRange } from './diffViewerVirtualization'

const WorkspaceMonacoDiffView = lazy(async () => {
  const diffModule = await preloadWorkspaceMonacoDiffView()
  return { default: diffModule.WorkspaceMonacoDiffView }
})

interface DiffViewerProps {
  className?: string
  collapsible?: boolean
  contextLines?: number
  defaultExpanded?: boolean
  diffCacheKey?: string
  filePath: string
  stableHeaderLayout?: boolean
  headerFileChange?: Pick<ConversationFileDiff, 'changeStatus' | 'isDeleted' | 'originalFileName'>
  headerClassName?: string
  headerInlineContent?: ReactNode
  headerRightContent?: ReactNode
  headerTrailingContent?: ReactNode
  isExpanded?: boolean
  isContentLoading?: boolean
  isStreaming?: boolean
  layout?: 'card' | 'stacked'
  maxBodyHeightClassName?: string
  newContent: string
  onExpandedChange?: (nextValue: boolean) => void
  onPrewarmReady?: () => void
  oldContent: string | null | undefined
  prewarm?: boolean
  showHeader?: boolean
  startLineNumber?: number
  viewOnly?: boolean
}

const DEFAULT_DIFF_CONTEXT_LINES = 5

function areDiffViewerPropsEqual(left: DiffViewerProps, right: DiffViewerProps) {
  return (
    left.className === right.className &&
    left.collapsible === right.collapsible &&
    left.contextLines === right.contextLines &&
    left.defaultExpanded === right.defaultExpanded &&
    left.diffCacheKey === right.diffCacheKey &&
    left.filePath === right.filePath &&
    left.stableHeaderLayout === right.stableHeaderLayout &&
    left.headerFileChange === right.headerFileChange &&
    left.headerClassName === right.headerClassName &&
    left.headerInlineContent === right.headerInlineContent &&
    left.headerRightContent === right.headerRightContent &&
    left.headerTrailingContent === right.headerTrailingContent &&
    left.isExpanded === right.isExpanded &&
    left.isContentLoading === right.isContentLoading &&
    left.isStreaming === right.isStreaming &&
    left.layout === right.layout &&
    left.maxBodyHeightClassName === right.maxBodyHeightClassName &&
    left.newContent === right.newContent &&
    left.onExpandedChange === right.onExpandedChange &&
    left.onPrewarmReady === right.onPrewarmReady &&
    left.oldContent === right.oldContent &&
    left.prewarm === right.prewarm &&
    left.showHeader === right.showHeader &&
    left.startLineNumber === right.startLineNumber &&
    left.viewOnly === right.viewOnly
  )
}

function DiffViewerComponent({
  className,
  collapsible = false,
  contextLines = DEFAULT_DIFF_CONTEXT_LINES,
  defaultExpanded = true,
  diffCacheKey,
  filePath,
  stableHeaderLayout = false,
  headerFileChange,
  headerClassName,
  headerInlineContent,
  headerRightContent,
  headerTrailingContent,
  isExpanded: expandedProp,
  isContentLoading = false,
  isStreaming = false,
  layout = 'card',
  maxBodyHeightClassName,
  newContent,
  onExpandedChange,
  onPrewarmReady,
  oldContent,
  prewarm = false,
  showHeader = true,
  startLineNumber = 1,
  viewOnly = false,
}: DiffViewerProps) {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded)
  const isExpanded = expandedProp ?? internalExpanded
  const shouldRenderDiffContent = !collapsible || isExpanded || prewarm
  const isPrewarmOnly = prewarm && collapsible && !isExpanded
  const isStackedLayout = layout === 'stacked'
  const initialBodyHeight = estimateWorkspaceMonacoDiffHeight(
    oldContent,
    newContent,
    contextLines,
    resolveWorkspaceMonacoDiffMaxHeight(maxBodyHeightClassName),
    viewOnly,
  )
  const header = (
    <DiffFileHeader
      filePath={filePath}
      fileChange={headerFileChange}
      collapsible={collapsible}
      isExpanded={isExpanded}
      stableLayout={stableHeaderLayout}
      className={headerClassName}
      inlineContent={headerInlineContent}
      rightContent={headerRightContent}
      trailingContent={headerTrailingContent}
      onToggle={() => {
        const nextExpanded = !isExpanded
        if (expandedProp === undefined) {
          setInternalExpanded(nextExpanded)
        }
        onExpandedChange?.(nextExpanded)
      }}
    />
  )

  return (
    <div
      className={[
        isPrewarmOnly
          ? 'pointer-events-none absolute left-[-100000px] top-0 z-[-1] h-[360px] w-[900px] overflow-hidden opacity-0'
          : '',
        isStackedLayout
          ? 'my-0 w-full overflow-hidden rounded-none border-0 border-b border-border bg-surface shadow-none'
          : 'my-2 w-full overflow-hidden rounded-2xl border border-border bg-surface shadow-sm',
        headerFileChange && isStackedLayout ? 'border-border/60' : '',
        className ?? '',
      ].join(' ')}
    >
      {!isPrewarmOnly && showHeader ? header : null}
      {shouldRenderDiffContent ? (
        <div
          data-diff-content="true"
          aria-busy={isContentLoading}
          className={[
            'selectable-ui',
            isStackedLayout ? 'overflow-hidden bg-surface' : 'overflow-hidden rounded-b-2xl bg-surface',
          ].join(' ')}
        >
          {isContentLoading ? (
            <WorkspaceMonacoDiffLoadingView height={initialBodyHeight} />
          ) : (
            <Suspense fallback={<WorkspaceMonacoDiffLoadingView height={initialBodyHeight} />}>
              <WorkspaceMonacoDiffView
                key={diffCacheKey ?? filePath}
                contextLines={contextLines}
                contentSignature={diffCacheKey}
                filePath={filePath}
                isStreaming={isStreaming}
                maxBodyHeightClassName={maxBodyHeightClassName}
                newContent={newContent}
                onReady={onPrewarmReady}
                oldContent={oldContent}
                startLineNumber={startLineNumber}
                viewOnly={viewOnly}
              />
            </Suspense>
          )}
        </div>
      ) : null}
    </div>
  )
}

export const DiffViewer = memo(DiffViewerComponent, areDiffViewerPropsEqual)
