import { lazy, memo, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { resolveFileIconConfig } from '../../lib/fileIconResolver'
import { PathLabel } from './PathLabel'
import { WorkspaceMonacoDiffLoadingView } from './diffViewer/WorkspaceMonacoDiffLoadingView'
import { clampWorkspaceMonacoDiffHeight, resolveWorkspaceMonacoDiffMaxHeight } from './diffViewer/workspaceMonacoDiffConfig'
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
  onPrewarmReady?: () => void
  oldContent: string | null | undefined
  prewarm?: boolean
  startLineNumber?: number
  viewOnly?: boolean
}

const DEFAULT_DIFF_CONTEXT_LINES = 5
const INITIAL_DIFF_HEIGHT_PX = 160

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
    left.onPrewarmReady === right.onPrewarmReady &&
    left.oldContent === right.oldContent &&
    left.prewarm === right.prewarm &&
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
  onPrewarmReady,
  oldContent,
  prewarm = false,
  startLineNumber = 1,
  viewOnly = false,
}: DiffViewerProps) {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded)
  const isExpanded = expandedProp ?? internalExpanded
  const shouldRenderDiffContent = !collapsible || isExpanded || prewarm
  const isPrewarmOnly = prewarm && collapsible && !isExpanded
  const isStackedLayout = layout === 'stacked'
  const iconConfig = useMemo(() => resolveFileIconConfig({ fileName: filePath }), [filePath])
  const FileIcon = iconConfig.icon
  const initialBodyHeight = clampWorkspaceMonacoDiffHeight(
    INITIAL_DIFF_HEIGHT_PX,
    resolveWorkspaceMonacoDiffMaxHeight(maxBodyHeightClassName),
  )
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

  useEffect(() => {
    void preloadWorkspaceMonacoDiffView().catch(() => undefined)
  }, [])

  const hasRightHeaderContent = Boolean(headerRightContent)
  const header = collapsible ? (
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
        className ?? '',
      ].join(' ')}
    >
      {!isPrewarmOnly ? header : null}
      {shouldRenderDiffContent ? (
        <div className={isStackedLayout ? 'overflow-hidden bg-surface' : 'overflow-hidden rounded-b-2xl bg-surface'}>
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
        </div>
      ) : null}
    </div>
  )
}

export const DiffViewer = memo(DiffViewerComponent, areDiffViewerPropsEqual)
