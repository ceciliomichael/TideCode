import { ChevronRight, Eye, LoaderCircle, TriangleAlert, X } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import { isMarkdownPreviewablePath } from '../../lib/markdown-preview'
import { resolveFileIconConfig } from '../../lib/fileIconResolver'
import { clampWorkspaceEditorWidth } from '../../lib/workspaceEditorSizing'
import type { GitFileDiff } from '../../types/chat'
import type { WorkspaceTab } from './types'
import { WorkspaceFileTabsPanelContent } from './workspaceFileTabsPanel/WorkspaceFileTabsPanelContent'

interface WorkspaceFileTabsPanelProps {
  activeTabKey: string | null
  gitFileDiffs: readonly GitFileDiff[]
  isOpen: boolean
  onCloseTab: (tabKey: string) => void
  onFileContentChange: (relativePath: string, content: string) => void
  onOpenMarkdownPreview: (relativePath: string) => void
  onSelectTab: (tabKey: string) => void
  onWidthChange: (nextWidth: number) => void
  onWidthCommit: (nextWidth: number) => void
  tabs: readonly WorkspaceTab[]
  width: number
  wordWrapEnabled: boolean
}

export function WorkspaceFileTabsPanel({
  activeTabKey,
  gitFileDiffs,
  isOpen,
  onCloseTab,
  onFileContentChange,
  onOpenMarkdownPreview,
  onSelectTab,
  onWidthChange,
  onWidthCommit,
  tabs,
  width,
  wordWrapEnabled,
}: WorkspaceFileTabsPanelProps) {
  const hasTabs = tabs.length > 0
  const activeTab = tabs.find((tab) => tab.tabKey === activeTabKey) ?? null
  const panelRef = useRef<HTMLElement | null>(null)
  const tabsViewportRef = useRef<HTMLDivElement | null>(null)
  const resizeDragStateRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null)
  const resizeAnimationFrameRef = useRef<number | null>(null)
  const renderedWidthRef = useRef(width)
  const dragStateRef = useRef<{ pointerId: number; startX: number; startThumbLeft: number } | null>(null)
  const [renderedWidth, setRenderedWidth] = useState(width)
  const [tabsScrollMetrics, setTabsScrollMetrics] = useState({
    canScroll: false,
    thumbLeft: 0,
    thumbWidth: 0,
  })
  const [isResizing, setIsResizing] = useState(false)

  useEffect(() => {
    if (isResizing) {
      return
    }
    setRenderedWidth(width)
  }, [isResizing, width])

  useEffect(() => {
    renderedWidthRef.current = renderedWidth
    if (panelRef.current) {
      panelRef.current.style.width = `${renderedWidth}px`
    }
  }, [renderedWidth])

  const updateTabsScrollMetrics = useCallback(() => {
    const viewport = tabsViewportRef.current
    if (!viewport) {
      return
    }

    const { clientWidth, scrollLeft, scrollWidth } = viewport
    const canScroll = scrollWidth > clientWidth + 1
    if (!canScroll || clientWidth === 0) {
      setTabsScrollMetrics({
        canScroll: false,
        thumbLeft: 0,
        thumbWidth: 0,
      })
      return
    }

    const thumbWidth = Math.max(24, Math.round((clientWidth / scrollWidth) * clientWidth))
    const maxThumbLeft = Math.max(0, clientWidth - thumbWidth)
    const maxScrollLeft = Math.max(1, scrollWidth - clientWidth)
    const thumbLeft = Math.round((scrollLeft / maxScrollLeft) * maxThumbLeft)

    setTabsScrollMetrics({
      canScroll: true,
      thumbLeft,
      thumbWidth,
    })
  }, [])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const panelElement = tabsViewportRef.current?.closest('section')
    const parentWidth = panelElement?.parentElement?.clientWidth ?? window.innerWidth
    const clampedWidth = clampWorkspaceEditorWidth(renderedWidth, parentWidth)
    if (clampedWidth !== renderedWidth) {
      setRenderedWidth(clampedWidth)
      onWidthChange(clampedWidth)
    }

    const viewport = tabsViewportRef.current
    if (!viewport) {
      return
    }

    updateTabsScrollMetrics()
    const handleScroll = () => updateTabsScrollMetrics()
    viewport.addEventListener('scroll', handleScroll, { passive: true })
    const resizeObserver = new ResizeObserver(() => updateTabsScrollMetrics())
    resizeObserver.observe(viewport)
    window.addEventListener('resize', updateTabsScrollMetrics)

    return () => {
      viewport.removeEventListener('scroll', handleScroll)
      resizeObserver.disconnect()
      window.removeEventListener('resize', updateTabsScrollMetrics)
    }
  }, [isOpen, onWidthChange, renderedWidth, tabs, updateTabsScrollMetrics])

  useEffect(() => {
    function handleResizePointerMove(event: PointerEvent) {
      const dragState = resizeDragStateRef.current
      if (!dragState) {
        return
      }

      const panelElement = tabsViewportRef.current?.closest('section')
      const parentWidth = panelElement?.parentElement?.clientWidth ?? window.innerWidth
      const nextWidth = clampWorkspaceEditorWidth(
        dragState.startWidth - (event.clientX - dragState.startX),
        parentWidth,
      )
      renderedWidthRef.current = nextWidth

      if (resizeAnimationFrameRef.current !== null) {
        return
      }

      resizeAnimationFrameRef.current = window.requestAnimationFrame(() => {
        resizeAnimationFrameRef.current = null
        if (panelRef.current) {
          panelRef.current.style.width = `${renderedWidthRef.current}px`
        }
      })
    }

    function handleResizePointerUp(event: PointerEvent) {
      if (resizeDragStateRef.current?.pointerId !== event.pointerId) {
        return
      }

      const dragState = resizeDragStateRef.current
      resizeDragStateRef.current = null
      if (resizeAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeAnimationFrameRef.current)
        resizeAnimationFrameRef.current = null
      }
      setIsResizing(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''

      if (!dragState) {
        return
      }

      const panelElement = tabsViewportRef.current?.closest('section')
      const parentWidth = panelElement?.parentElement?.clientWidth ?? window.innerWidth
      const committedWidth = clampWorkspaceEditorWidth(
        dragState.startWidth - (event.clientX - dragState.startX),
        parentWidth,
      )
      renderedWidthRef.current = committedWidth
      setRenderedWidth(committedWidth)
      onWidthChange(committedWidth)
      onWidthCommit(committedWidth)
    }

    window.addEventListener('pointermove', handleResizePointerMove)
    window.addEventListener('pointerup', handleResizePointerUp)

    return () => {
      window.removeEventListener('pointermove', handleResizePointerMove)
      window.removeEventListener('pointerup', handleResizePointerUp)
      if (resizeAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeAnimationFrameRef.current)
        resizeAnimationFrameRef.current = null
      }
      if (resizeDragStateRef.current) {
        resizeDragStateRef.current = null
        setIsResizing(false)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
  }, [onWidthChange, onWidthCommit])

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const dragState = dragStateRef.current
      const viewport = tabsViewportRef.current
      if (!dragState || !viewport || !tabsScrollMetrics.canScroll) {
        return
      }

      const { clientWidth, scrollWidth } = viewport
      const maxScrollLeft = Math.max(1, scrollWidth - clientWidth)
      const maxThumbLeft = Math.max(1, clientWidth - tabsScrollMetrics.thumbWidth)
      const deltaX = event.clientX - dragState.startX
      const nextThumbLeft = Math.min(Math.max(dragState.startThumbLeft + deltaX, 0), maxThumbLeft)
      viewport.scrollLeft = (nextThumbLeft / maxThumbLeft) * maxScrollLeft
    }

    function handlePointerUp(event: PointerEvent) {
      if (dragStateRef.current?.pointerId !== event.pointerId) {
        return
      }

      dragStateRef.current = null
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      dragStateRef.current = null
    }
  }, [tabsScrollMetrics.canScroll, tabsScrollMetrics.thumbWidth])

  if (!isOpen || !hasTabs || !activeTab) {
    return null
  }

  const breadcrumbSegments = activeTab.relativePath.split(/[\\/]+/).filter((segment) => segment.length > 0)

  function handleThumbPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    const pointerId = event.pointerId
    dragStateRef.current = {
      pointerId,
      startThumbLeft: tabsScrollMetrics.thumbLeft,
      startX: event.clientX,
    }
    event.currentTarget.setPointerCapture(pointerId)
  }

  function handleResizePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return
    }

    resizeDragStateRef.current = {
      pointerId: event.pointerId,
      startWidth: renderedWidthRef.current,
      startX: event.clientX,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
    event.stopPropagation()
    setIsResizing(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  function handleTabsWheel(event: ReactWheelEvent<HTMLDivElement>) {
    const viewport = tabsViewportRef.current
    if (!viewport || !tabsScrollMetrics.canScroll) {
      return
    }

    const dominantDelta = Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX
    if (dominantDelta === 0) {
      return
    }

    event.preventDefault()
    viewport.scrollLeft += dominantDelta
  }

  const markdownPreviewTab =
    activeTab.kind === 'markdown-preview'
      ? tabs.find((tab) => tab.kind === 'file' && tab.relativePath === activeTab.relativePath) ?? null
      : null

  const previewTabContent =
    activeTab.kind === 'markdown-preview'
      ? markdownPreviewTab
      : activeTab.kind === 'file' && isMarkdownPreviewablePath(activeTab.relativePath)
        ? activeTab
        : null

  return (
    <section
      ref={panelRef}
      className={['relative flex h-full shrink-0 min-w-0 flex-col border-l border-border bg-background', isResizing ? '' : 'transition-[width] duration-150 ease-out'].join(' ')}
      style={{ width: `${renderedWidth}px` }}
    >
      <div className="group relative h-10 border-b border-border bg-background">
        <div
          ref={tabsViewportRef}
          onWheel={handleTabsWheel}
          className="workspace-tabs-scroll-viewport flex h-full items-stretch gap-0 overflow-x-auto overflow-y-hidden"
        >
          {tabs.map((tab) => {
            const isActive = tab.tabKey === activeTab.tabKey
            const isPreviewTab = tab.kind === 'markdown-preview'
            const resolvedIconConfig = isPreviewTab ? null : resolveFileIconConfig({ fileName: tab.relativePath })

            return (
              <div key={tab.tabKey} className="group relative inline-flex h-full shrink-0 items-stretch border-r border-border">
                <button
                  type="button"
                  onClick={() => onSelectTab(tab.tabKey)}
                  onMouseDown={(event) => {
                    if (event.button !== 1) {
                      return
                    }
                    event.preventDefault()
                    onCloseTab(tab.tabKey)
                  }}
                  className={[
                    'inline-flex h-full max-w-[248px] items-center gap-2 px-3 pr-9 text-sm transition-colors',
                    isActive
                      ? 'border-t-2 border-t-foreground/60 bg-background text-foreground'
                      : 'border-t-2 border-t-transparent bg-background text-muted-foreground hover:bg-surface-muted hover:text-foreground',
                  ].join(' ')}
                >
                  {isPreviewTab ? (
                    <Eye size={14} className="shrink-0 text-[#8771FF]" />
                  ) : (
                    (() => {
                      const FileIcon = resolvedIconConfig!.icon
                      return <FileIcon size={14} className="shrink-0" style={{ color: resolvedIconConfig!.color }} />
                    })()
                  )}
                  <span className="truncate">{tab.fileName}</span>
                  {!isPreviewTab && tab.status === 'loading' ? <LoaderCircle size={12} className="shrink-0 animate-spin" /> : null}
                  {!isPreviewTab && tab.status === 'error' ? <TriangleAlert size={12} className="shrink-0" /> : null}
                </button>
                <button
                  type="button"
                  onClick={() => onCloseTab(tab.tabKey)}
                  className="absolute right-1 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                  aria-label={`Close ${tab.fileName}`}
                >
                  <X size={14} />
                </button>
              </div>
            )
          })}
        </div>
        {tabsScrollMetrics.canScroll ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              onPointerDown={handleThumbPointerDown}
              className="pointer-events-auto absolute top-0 h-full bg-[var(--color-scrollbar-thumb)] transition-colors hover:bg-[var(--color-scrollbar-thumb-hover)]"
              style={{
                borderRadius: 0,
                left: `${tabsScrollMetrics.thumbLeft}px`,
                width: `${tabsScrollMetrics.thumbWidth}px`,
              }}
              aria-label="Scroll tabs"
            />
          </div>
        ) : null}
      </div>

      {activeTab.kind === 'markdown-preview' ? null : (
        <div className="flex h-7 items-center bg-surface px-2">
          <div className="flex min-w-0 items-center gap-1 overflow-hidden text-[12px] text-subtle-foreground">
            {breadcrumbSegments.map((segment, index) => (
              <span key={`${segment}-${index}`} className="inline-flex min-w-0 items-center gap-1.5">
                {index > 0 ? <ChevronRight size={12} className="shrink-0 text-subtle-foreground/70" /> : null}
                <span className="truncate" title={activeTab.relativePath}>
                  {segment}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        {!hasTabs || !activeTab ? null : (
          <WorkspaceFileTabsPanelContent
            activeTab={activeTab}
            gitFileDiffs={gitFileDiffs}
            tabs={tabs}
            onFileContentChange={onFileContentChange}
            onOpenMarkdownPreview={
              previewTabContent && previewTabContent.kind === 'file'
                ? () => onOpenMarkdownPreview(previewTabContent.relativePath)
                : undefined
            }
            wordWrapEnabled={wordWrapEnabled}
          />
        )}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize editor panel"
        onPointerDown={handleResizePointerDown}
        className="absolute inset-y-0 left-0 z-20 w-3 -translate-x-1/2 cursor-col-resize"
      />
    </section>
  )
}
