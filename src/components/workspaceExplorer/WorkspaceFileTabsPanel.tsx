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
import { isDocxPreviewablePath } from '../../lib/docx-preview'
import { isImagePreviewablePath } from '../../lib/image-preview'
import { isPdfPreviewablePath } from '../../lib/pdf-preview'
import { isSvgPreviewablePath } from '../../lib/svg-preview'
import { resolveFileIconConfig } from '../../lib/fileIconResolver'
import type { GitFileDiff } from '../../types/chat'
import { Tooltip } from '../Tooltip'
import type { WorkspaceTab } from './types'
import type { TextSelectionRange } from './workspaceFileEditor/workspaceFileEditorUtils'
import { WorkspaceFileTabsPanelContent } from './workspaceFileTabsPanel/WorkspaceFileTabsPanelContent'
import { findWorkspaceTabByKey } from './workspaceFileTabsPanel/workspaceFileTabsPanelUtils'

interface WorkspaceFileTabsPanelProps {
  activeTabKey: string | null
  gitFileDiffs: readonly GitFileDiff[]
  hasRepository: boolean
  isOpen: boolean
  onCloseTab: (tabKey: string) => void
  onFileContentChange: (relativePath: string, content: string) => void
  onOpenMarkdownPreview: (relativePath: string) => void
  onOpenSvgPreview: (relativePath: string) => void
  onSelectTab: (tabKey: string) => void
  tabs: readonly WorkspaceTab[]
  wordWrapEnabled: boolean
}

export function WorkspaceFileTabsPanel({
  activeTabKey,
  gitFileDiffs,
  hasRepository,
  isOpen,
  onCloseTab,
  onFileContentChange,
  onOpenMarkdownPreview,
  onOpenSvgPreview,
  onSelectTab,
  tabs,
  wordWrapEnabled,
}: WorkspaceFileTabsPanelProps) {
  const hasTabs = tabs.length > 0
  const activeTab = findWorkspaceTabByKey(tabs, activeTabKey)
  const editorSelectionsRef = useRef(new Map<string, TextSelectionRange>())
  const activeEditorTabKeyRef = useRef<string | null>(null)
  const tabsViewportRef = useRef<HTMLDivElement | null>(null)
  const dragStateRef = useRef<{ pointerId: number; startX: number; startThumbLeft: number } | null>(null)
  const [tabsScrollMetrics, setTabsScrollMetrics] = useState({
    canScroll: false,
    thumbLeft: 0,
    thumbWidth: 0,
  })

  const activeEditorSelection =
    activeTab?.kind === 'file' ? editorSelectionsRef.current.get(activeTab.tabKey) ?? null : null

  activeEditorTabKeyRef.current = activeTab?.kind === 'file' ? activeTab.tabKey : null

  const handleEditorSelectionChange = useCallback((selection: TextSelectionRange | null) => {
    const activeFileTabKey = activeEditorTabKeyRef.current
    if (!activeFileTabKey) {
      return
    }

    if (selection) {
      editorSelectionsRef.current.set(activeFileTabKey, selection)
      return
    }

    editorSelectionsRef.current.delete(activeFileTabKey)
  }, [])

  useEffect(() => {
    const openTabKeys = new Set(tabs.map((tab) => tab.tabKey))
    for (const tabKey of editorSelectionsRef.current.keys()) {
      if (!openTabKeys.has(tabKey)) {
        editorSelectionsRef.current.delete(tabKey)
      }
    }
  }, [tabs])

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
  }, [isOpen, tabs, updateTabsScrollMetrics])

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

  const openMarkdownPreviewForActiveFile =
    activeTab.kind === 'file' && isMarkdownPreviewablePath(activeTab.relativePath)
      ? () => onOpenMarkdownPreview(activeTab.relativePath)
      : undefined
  const openSvgPreviewForActiveFile =
    activeTab.kind === 'file' && isSvgPreviewablePath(activeTab.relativePath)
      ? () => onOpenSvgPreview(activeTab.relativePath)
      : undefined

  return (
    <section className="relative flex min-w-0 flex-1 flex-col border-l border-border bg-background">
      <div className="group relative h-10 border-b border-border bg-background">
        <div
          ref={tabsViewportRef}
          onWheel={handleTabsWheel}
          className="workspace-tabs-scroll-viewport flex h-full items-stretch gap-0 overflow-x-auto overflow-y-hidden"
        >
          {tabs.map((tab) => {
            const isActive = tab.tabKey === activeTab.tabKey
            const isPreviewTab = tab.kind === 'markdown-preview' || tab.kind === 'svg-preview'
            const resolvedIconConfig = isPreviewTab ? null : resolveFileIconConfig({ fileName: tab.relativePath })

            let isNewFile = false
            if (tab.kind === 'file') {
              const normalizedRelativePath = tab.relativePath.trim().replace(/\\/g, '/').replace(/^\/+/u, '')
              const gitDiff = gitFileDiffs.find((diff) => diff.fileName.trim().replace(/\\/g, '/').replace(/^\/+/u, '') === normalizedRelativePath)
              if (gitDiff) {
                isNewFile = gitDiff.isUntracked || gitDiff.oldContent === null
              }
            }

            return (
              <div key={tab.tabKey} className="group relative inline-flex h-full shrink-0 items-stretch border-r border-border">
                <button
                  type="button"
                  data-workspace-tab-switch="true"
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
                      ? 'border-t-2 border-t-brand bg-background text-foreground'
                      : 'border-t-2 border-t-transparent bg-background text-muted-foreground hover:bg-surface-muted hover:text-foreground',
                  ].join(' ')}
                >
                  {isPreviewTab ? (
                    <Eye size={14} className="shrink-0 text-brand" />
                  ) : (
                    (() => {
                      const FileIcon = resolvedIconConfig!.icon
                      return <FileIcon size={14} className="shrink-0" style={{ color: resolvedIconConfig!.color }} />
                    })()
                  )}
                  <span className={`truncate ${isNewFile ? 'text-[var(--workspace-editor-line-added-border)]' : ''}`}>{tab.fileName}</span>
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

      {activeTab.kind === 'markdown-preview' ||
      activeTab.kind === 'svg-preview' ||
      (activeTab.kind === 'file' &&
        activeTab.isBinary &&
        (isDocxPreviewablePath(activeTab.relativePath) ||
          isImagePreviewablePath(activeTab.relativePath) ||
          isPdfPreviewablePath(activeTab.relativePath))) ? null : (
        <div className="flex h-7 items-center bg-surface px-2">
          <div className="flex min-w-0 items-center gap-1 overflow-hidden text-[12px] text-subtle-foreground">
            {breadcrumbSegments.map((segment, index) => (
              <span key={`${segment}-${index}`} className="inline-flex min-w-0 items-center gap-1.5">
                {index > 0 ? <ChevronRight size={12} className="shrink-0 text-subtle-foreground/70" /> : null}
                <Tooltip content={activeTab.relativePath} side="bottom" noWrap triggerClassName="min-w-0">
                  <span className="truncate">{segment}</span>
                </Tooltip>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        <WorkspaceFileTabsPanelContent
          activeTab={activeTab}
          gitFileDiffs={gitFileDiffs}
          hasRepository={hasRepository}
          initialSelection={activeEditorSelection}
          tabs={tabs}
          onFileContentChange={onFileContentChange}
          onOpenMarkdownPreview={openMarkdownPreviewForActiveFile}
          onOpenSvgPreview={openSvgPreviewForActiveFile}
          onSelectionChange={handleEditorSelectionChange}
          wordWrapEnabled={wordWrapEnabled}
        />
      </div>
    </section>
  )
}
