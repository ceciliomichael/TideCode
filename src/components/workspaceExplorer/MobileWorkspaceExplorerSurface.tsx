import { ChevronRight, Eye, FileText } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PlanReviewComment } from '../../lib/planContracts'
import type { GitFileDiff } from '../../types/chat'
import type { ChatWorkspaceUiState } from '../../pages/chatInterface/useChatWorkspaceUiState'
import { WorkspaceExplorerPanel } from './WorkspaceExplorerPanel'
import { WorkspaceFileTabsPanelContent } from './workspaceFileTabsPanel/WorkspaceFileTabsPanelContent'
import {
  findMobileWorkspaceFileViewTab,
  findMobileWorkspacePreviewTab,
  isMobileBinaryPreviewablePath,
  isMobilePreviewablePath,
  type MobileWorkspaceExplorerView,
} from './mobileWorkspaceExplorerUtils'

interface MobileWorkspaceExplorerSurfaceProps {
  gitFileDiffs: readonly GitFileDiff[]
  hasRepository: boolean
  onExit: () => void
  onImplementPlan: (relativePath: string) => void
  onRequestPlanChanges: (relativePath: string, comments: PlanReviewComment[]) => void
  wordWrapEnabled: boolean
  workspaceState: ChatWorkspaceUiState
}

export function MobileWorkspaceExplorerSurface({
  gitFileDiffs,
  hasRepository,
  onExit,
  onImplementPlan,
  onRequestPlanChanges,
  wordWrapEnabled,
  workspaceState,
}: MobileWorkspaceExplorerSurfaceProps) {
  const [view, setView] = useState<MobileWorkspaceExplorerView>('explorer')
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const onExitRef = useRef(onExit)
  const workspaceStateRef = useRef(workspaceState)
  onExitRef.current = onExit
  workspaceStateRef.current = workspaceState

  const fileViewTab = useMemo(
    () =>
      selectedFilePath
        ? findMobileWorkspaceFileViewTab(workspaceState.workspaceFileTabs, selectedFilePath)
        : null,
    [selectedFilePath, workspaceState.workspaceFileTabs],
  )
  const previewTab = useMemo(
    () =>
      selectedFilePath
        ? findMobileWorkspacePreviewTab(workspaceState.workspaceFileTabs, selectedFilePath)
        : null,
    [selectedFilePath, workspaceState.workspaceFileTabs],
  )

  const canPreview =
    selectedFilePath !== null &&
    isMobilePreviewablePath(selectedFilePath) &&
    fileViewTab?.kind !== 'plan-preview'

  const pushMobileHistory = useCallback((
    nextView: MobileWorkspaceExplorerView,
    relativePath: string | null,
    depth: number,
  ) => {
    const currentState =
      typeof window.history.state === 'object' && window.history.state !== null
        ? window.history.state
        : {}
    window.history.pushState(
      {
        ...currentState,
        tidecodeMobileExplorer: true,
        tidecodeMobileExplorerDepth: depth,
        tidecodeMobileExplorerPath: relativePath,
        tidecodeMobileExplorerView: nextView,
      },
      '',
    )
  }, [])

  useEffect(() => {
    pushMobileHistory('explorer', null, 1)

    const handlePopState = (event: PopStateEvent) => {
      const state =
        typeof event.state === 'object' && event.state !== null
          ? event.state as Record<string, unknown>
          : null
      if (state?.tidecodeMobileExplorer !== true) {
        onExitRef.current()
        return
      }

      const nextView = state.tidecodeMobileExplorerView
      const nextPath =
        typeof state.tidecodeMobileExplorerPath === 'string'
          ? state.tidecodeMobileExplorerPath
          : null

      if (nextView !== 'explorer' && nextView !== 'file' && nextView !== 'preview') {
        onExitRef.current()
        return
      }

      setSelectedFilePath(nextPath)
      setView(nextView)

      if (nextView === 'file' && nextPath) {
        const sourceTab = findMobileWorkspaceFileViewTab(
          workspaceStateRef.current.workspaceFileTabs,
          nextPath,
        )
        if (sourceTab) {
          workspaceStateRef.current.handleSelectWorkspaceTab(sourceTab.tabKey)
        }
      } else if (nextView === 'preview' && nextPath) {
        const targetPreviewTab = findMobileWorkspacePreviewTab(
          workspaceStateRef.current.workspaceFileTabs,
          nextPath,
        )
        if (targetPreviewTab) {
          workspaceStateRef.current.handleSelectWorkspaceTab(targetPreviewTab.tabKey)
        }
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [pushMobileHistory])

  const handleOpenFile = useCallback(
    (relativePath: string) => {
      setSelectedFilePath(relativePath)
      setView('file')
      pushMobileHistory('file', relativePath, 2)
      workspaceState.handleOpenWorkspaceFile(relativePath)
    },
    [pushMobileHistory, workspaceState],
  )

  const handleOpenPreview = useCallback(() => {
    if (!selectedFilePath || !isMobilePreviewablePath(selectedFilePath)) {
      return
    }

    if (selectedFilePath.toLowerCase().endsWith('.svg')) {
      workspaceState.handleOpenWorkspaceSvgPreview(selectedFilePath)
    } else if (
      selectedFilePath.toLowerCase().endsWith('.md') ||
      selectedFilePath.toLowerCase().endsWith('.markdown')
    ) {
      workspaceState.handleOpenWorkspaceMarkdownPreview(selectedFilePath)
    }

    setView('preview')
    pushMobileHistory('preview', selectedFilePath, 3)
  }, [pushMobileHistory, selectedFilePath, workspaceState])

  const handleEditorPreview = useCallback(() => {
    handleOpenPreview()
  }, [handleOpenPreview])

  const renderFileContent = () => {
    if (!selectedFilePath || !fileViewTab) {
      return (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-sm text-subtle-foreground">
          Opening file...
        </div>
      )
    }

    if (
      fileViewTab.kind === 'file' &&
      fileViewTab.status === 'ready' &&
      fileViewTab.isBinary &&
      isMobileBinaryPreviewablePath(selectedFilePath)
    ) {
      return (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6">
          <div className="flex max-w-xs flex-col items-center gap-3 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-muted text-muted-foreground">
              <FileText size={22} aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">{fileViewTab.fileName}</p>
              <p className="mt-1 text-sm leading-6 text-subtle-foreground">
                This file is available in preview mode.
              </p>
            </div>
            <button
              type="button"
              onClick={handleOpenPreview}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-medium text-foreground transition-colors active:bg-surface-muted"
            >
              <Eye size={15} aria-hidden="true" />
              Preview
            </button>
          </div>
        </div>
      )
    }

    return (
      <WorkspaceFileTabsPanelContent
        activeTab={fileViewTab}
        gitFileDiffs={gitFileDiffs}
        hasRepository={hasRepository}
        initialSelection={null}
        tabs={workspaceState.workspaceFileTabs}
        onFileContentChange={workspaceState.handleWorkspaceFileContentChange}
        onPlanCommentsChange={workspaceState.handlePlanCommentsChange}
        onImplementPlan={onImplementPlan}
        onOpenFile={handleOpenFile}
        onOpenMarkdownPreview={handleEditorPreview}
        onOpenSvgPreview={handleEditorPreview}
        onRequestPlanChanges={onRequestPlanChanges}
        planCommentsByPath={workspaceState.planCommentsByPath}
        onSelectionChange={() => undefined}
        wordWrapEnabled={wordWrapEnabled}
        workspaceRootPath={workspaceState.activeWorkspacePath}
      />
    )
  }

  const renderPreviewContent = () => {
    if (!selectedFilePath || !previewTab) {
      return (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-sm text-subtle-foreground">
          Loading preview...
        </div>
      )
    }

    return (
      <WorkspaceFileTabsPanelContent
        activeTab={previewTab}
        gitFileDiffs={gitFileDiffs}
        hasRepository={hasRepository}
        initialSelection={null}
        tabs={workspaceState.workspaceFileTabs}
        onFileContentChange={workspaceState.handleWorkspaceFileContentChange}
        onPlanCommentsChange={workspaceState.handlePlanCommentsChange}
        onImplementPlan={onImplementPlan}
        onOpenFile={handleOpenFile}
        onRequestPlanChanges={onRequestPlanChanges}
        planCommentsByPath={workspaceState.planCommentsByPath}
        onSelectionChange={() => undefined}
        wordWrapEnabled={wordWrapEnabled}
        workspaceRootPath={workspaceState.activeWorkspacePath}
      />
    )
  }

  const displayedTab = view === 'preview' ? previewTab : fileViewTab
  const displayedTabIsPreview = view === 'preview' || displayedTab?.kind === 'plan-preview'
  const breadcrumbSegments =
    displayedTab && !displayedTabIsPreview
      ? displayedTab.relativePath.split(/[\\/]+/).filter((segment) => segment.length > 0)
      : []
  const showBreadcrumb =
    displayedTab?.kind === 'file' &&
    !displayedTabIsPreview &&
    !(
      displayedTab.isBinary &&
      isMobileBinaryPreviewablePath(displayedTab.relativePath)
    )

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background md:hidden">
      {view !== 'explorer' && displayedTab && showBreadcrumb ? (
        <div className="non-selectable-ui flex h-7 shrink-0 items-center justify-between gap-2 border-t border-border bg-surface px-2">
          <div className="flex min-w-0 items-center gap-1 overflow-hidden text-[12px] text-subtle-foreground">
            {breadcrumbSegments.map((segment, index) => (
              <span key={`${segment}-${index}`} className="inline-flex min-w-0 items-center gap-1.5">
                {index > 0 ? (
                  <ChevronRight size={12} className="shrink-0 text-subtle-foreground/70" />
                ) : null}
                <span className="truncate">{segment}</span>
              </span>
            ))}
          </div>
          {view === 'file' && canPreview ? (
            <button
              type="button"
              onClick={handleOpenPreview}
              className="inline-flex h-6 shrink-0 items-center gap-1 px-1.5 text-[12px] text-muted-foreground transition-colors active:text-foreground"
            >
              <Eye size={13} aria-hidden="true" />
              Preview
            </button>
          ) : null}
        </div>
      ) : view === 'file' && canPreview ? (
        <div className="non-selectable-ui flex h-7 shrink-0 items-center justify-end border-t border-border bg-surface px-2">
          <button
            type="button"
            onClick={handleOpenPreview}
            className="inline-flex h-6 items-center gap-1 px-1.5 text-[12px] text-muted-foreground transition-colors active:text-foreground"
          >
            <Eye size={13} aria-hidden="true" />
            Preview
          </button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {view === 'explorer' ? (
          <WorkspaceExplorerPanel
            activeFilePath={workspaceState.activeWorkspaceFilePath}
            clipboardEntry={workspaceState.workspaceClipboard}
            gitFileDiffs={gitFileDiffs}
            isOpen
            presentation="mobile"
            onCopyEntry={workspaceState.handleCopyWorkspaceEntry}
            onCreateEntry={workspaceState.handleCreateWorkspaceEntry}
            onCutEntry={workspaceState.handleCutWorkspaceEntry}
            onDeleteEntry={workspaceState.handleDeleteWorkspaceEntry}
            onImportEntry={workspaceState.handleImportWorkspaceEntry}
            onMoveEntry={workspaceState.handleMoveWorkspaceEntry}
            onOpenFile={handleOpenFile}
            onPasteEntry={workspaceState.handlePasteWorkspaceEntry}
            onRenameEntry={workspaceState.handleRenameWorkspaceEntry}
            onWidthChange={workspaceState.handleWorkspaceExplorerWidthChange}
            onWidthCommit={workspaceState.handleWorkspaceExplorerWidthCommit}
            width={workspaceState.workspaceExplorerWidth}
            workspaceRootPath={workspaceState.activeWorkspacePath}
          />
        ) : view === 'preview' ? (
          renderPreviewContent()
        ) : (
          renderFileContent()
        )}
      </div>
    </section>
  )
}
