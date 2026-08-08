import { memo } from 'react'
import { WorkspaceFileEditor } from '../WorkspaceFileEditor'
import { WorkspaceDocxPreview } from '../workspaceDocxPreview/WorkspaceDocxPreview'
import { WorkspaceImagePreview } from '../workspaceImagePreview/WorkspaceImagePreview'
import { WorkspaceMarkdownPreview } from '../workspaceMarkdownPreview/WorkspaceMarkdownPreview'
import { WorkspacePlanPreview } from '../workspacePlanPreview/WorkspacePlanPreview'
import { WorkspacePdfPreview } from '../workspacePdfPreview/WorkspacePdfPreview'
import { WorkspaceSvgPreview } from '../workspaceSvgPreview/WorkspaceSvgPreview'
import type { GitFileDiff } from '../../../types/chat'
import type { WorkspaceFileTab, WorkspaceTab } from '../types'
import type { PlanReviewComment } from '../../../lib/planContracts'
import type { TextSelectionRange } from '../workspaceFileEditor/workspaceFileEditorUtils'
import { isImagePreviewablePath } from '../../../lib/image-preview'
import { isDocxPreviewablePath } from '../../../lib/docx-preview'
import { normalizePathSeparators } from '../../../lib/filePathUtils'
import { isSvgPreviewablePath } from '../../../lib/svg-preview'
import { isPdfPreviewablePath } from '../../../lib/pdf-preview'
import { toUserFacingErrorMessage } from '../../../lib/userFacingError'

interface WorkspaceFileTabsPanelContentProps {
  activeTab: WorkspaceTab
  gitFileDiffs: readonly GitFileDiff[]
  hasRepository: boolean
  initialSelection: TextSelectionRange | null
  tabs: readonly WorkspaceTab[]
  onOpenMarkdownPreview?: () => void
  onOpenSvgPreview?: () => void
  onFileContentChange: (relativePath: string, content: string) => void
  onImplementPlan: (relativePath: string) => void
  onRequestPlanChanges: (relativePath: string, comments: PlanReviewComment[]) => void
  onSelectionChange: (selection: TextSelectionRange | null) => void
  wordWrapEnabled: boolean
}

function isWorkspaceFileTab(tab: WorkspaceTab): tab is WorkspaceFileTab {
  return tab.kind === 'file'
}

function normalizeWorkspaceFilePath(filePath: string) {
  return filePath.trim().replace(/\\/g, '/').replace(/^\/+/u, '')
}

function findGitFileDiff(gitFileDiffs: readonly GitFileDiff[], relativePath: string) {
  const normalizedRelativePath = normalizeWorkspaceFilePath(relativePath)
  return gitFileDiffs.find((diff) => normalizeWorkspaceFilePath(diff.fileName) === normalizedRelativePath) ?? null
}

function getTabErrorMessage(errorMessage: string | undefined, fallbackMessage: string) {
  return errorMessage ? toUserFacingErrorMessage(errorMessage, fallbackMessage) : fallbackMessage
}

export const WorkspaceFileTabsPanelContent = memo(function WorkspaceFileTabsPanelContent({
  activeTab,
  gitFileDiffs,
  hasRepository,
  initialSelection,
  tabs,
  onOpenMarkdownPreview,
  onOpenSvgPreview,
  onFileContentChange,
  onImplementPlan,
  onRequestPlanChanges,
  onSelectionChange,
  wordWrapEnabled,
}: WorkspaceFileTabsPanelContentProps) {
  if (activeTab.kind === 'markdown-preview') {
    const sourceTab = tabs.find(
      (tab): tab is WorkspaceFileTab =>
        isWorkspaceFileTab(tab) &&
        normalizePathSeparators(tab.relativePath) === normalizePathSeparators(activeTab.relativePath),
    )
    const contentToDisplay = sourceTab ? sourceTab.content : activeTab.content

    if (activeTab.status === 'loading' && !sourceTab) {
      return (
        <div className="flex h-full min-h-[200px] items-center justify-center text-sm text-subtle-foreground">
          Loading preview...
        </div>
      )
    }

    if (activeTab.status === 'error' && !sourceTab) {
      return (
        <div className="h-full border-t border-danger-border bg-danger-surface px-4 py-3 text-sm text-danger-foreground">
          {getTabErrorMessage(activeTab.errorMessage, 'The preview could not be loaded.')}
        </div>
      )
    }

    return (
      <WorkspaceMarkdownPreview
        content={contentToDisplay}
        fileName={activeTab.fileName}
        relativePath={activeTab.relativePath}
        isTruncated={sourceTab ? sourceTab.isTruncated : activeTab.isTruncated}
      />
    )
  }

  if (activeTab.kind === 'plan-preview') {
    if (activeTab.status === 'loading') {
      return (
        <div className="flex h-full min-h-[200px] items-center justify-center text-sm text-subtle-foreground">
          Loading {activeTab.fileName}...
        </div>
      )
    }

    if (activeTab.status === 'error') {
      return (
        <div className="h-full border-t border-danger-border bg-danger-surface px-4 py-3 text-sm text-danger-foreground">
          {getTabErrorMessage(activeTab.errorMessage, 'The plan could not be loaded.')}
        </div>
      )
    }

    return (
      <WorkspacePlanPreview
        content={activeTab.content}
        isTruncated={activeTab.isTruncated}
        onImplementPlan={onImplementPlan}
        onRequestChanges={onRequestPlanChanges}
        relativePath={activeTab.relativePath}
      />
    )
  }

  if (activeTab.kind === 'svg-preview') {
    const sourceTab = tabs.find(
      (tab): tab is WorkspaceFileTab =>
        isWorkspaceFileTab(tab) &&
        normalizePathSeparators(tab.relativePath) === normalizePathSeparators(activeTab.relativePath),
    )

    if (!sourceTab) {
      return (
        <div className="h-full border-t border-border bg-surface px-4 py-3 text-sm text-subtle-foreground">
          The source file is no longer open.
        </div>
      )
    }

    if (sourceTab.status === 'loading') {
      return (
        <div className="flex h-full min-h-[200px] items-center justify-center text-sm text-subtle-foreground">
          Loading {sourceTab.fileName}...
        </div>
      )
    }

    if (sourceTab.status === 'error') {
      return (
        <div className="h-full border-t border-danger-border bg-danger-surface px-4 py-3 text-sm text-danger-foreground">
          {getTabErrorMessage(sourceTab.errorMessage, 'The file could not be opened.')}
        </div>
      )
    }

    if (sourceTab.isBinary) {
      return (
        <div className="h-full border-t border-border bg-surface px-4 py-3 text-sm text-subtle-foreground">
          SVG view is not supported for binary file {sourceTab.fileName}.
        </div>
      )
    }

    return (
      <WorkspaceSvgPreview
        content={sourceTab.content}
        fileName={sourceTab.fileName}
        relativePath={sourceTab.relativePath}
        isTruncated={sourceTab.isTruncated}
      />
    )
  }

  if (activeTab.status === 'loading') {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center text-sm text-subtle-foreground">
        Loading {activeTab.fileName}...
      </div>
    )
  }

  if (activeTab.status === 'error') {
    return (
      <div className="h-full border-t border-danger-border bg-danger-surface px-4 py-3 text-sm text-danger-foreground">
        {getTabErrorMessage(activeTab.errorMessage, 'The file could not be opened.')}
      </div>
    )
  }

  if (activeTab.isBinary) {
    if (isDocxPreviewablePath(activeTab.relativePath)) {
      return (
        <WorkspaceDocxPreview
          fileName={activeTab.fileName}
          previewDataUrl={activeTab.previewDataUrl}
          previewError={activeTab.previewError}
          relativePath={activeTab.relativePath}
        />
      )
    }

    if (isPdfPreviewablePath(activeTab.relativePath)) {
      return (
        <WorkspacePdfPreview
          fileName={activeTab.fileName}
          previewDataUrl={activeTab.previewDataUrl}
          previewError={activeTab.previewError}
          relativePath={activeTab.relativePath}
        />
      )
    }

    if (isImagePreviewablePath(activeTab.relativePath)) {
      return (
        <WorkspaceImagePreview
          fileName={activeTab.fileName}
          previewDataUrl={activeTab.previewDataUrl}
          previewError={activeTab.previewError}
          relativePath={activeTab.relativePath}
        />
      )
    }

    return (
      <div className="h-full border-t border-border bg-surface px-4 py-3 text-sm text-subtle-foreground">
        Binary file view is not supported for {activeTab.fileName}.
      </div>
    )
  }

  return (
    <WorkspaceFileEditor
      key={activeTab.tabKey}
      fileName={activeTab.fileName}
      gitFileDiff={findGitFileDiff(gitFileDiffs, activeTab.relativePath)}
        hasRepository={hasRepository}
      initialSelection={initialSelection}
      onOpenMarkdownPreview={onOpenMarkdownPreview}
      onOpenSvgPreview={isSvgPreviewablePath(activeTab.relativePath) ? onOpenSvgPreview : undefined}
      originalContent={activeTab.originalContent}
      onSelectionChange={onSelectionChange}
      value={activeTab.content}
      wordWrapEnabled={wordWrapEnabled}
      onChange={(nextValue) => onFileContentChange(activeTab.relativePath, nextValue)}
    />
  )
})
