import { memo } from 'react'
import { WorkspaceFileEditor } from '../WorkspaceFileEditor'
import { WorkspaceMarkdownPreview } from '../workspaceMarkdownPreview/WorkspaceMarkdownPreview'
import { WorkspaceSvgPreview } from '../workspaceSvgPreview/WorkspaceSvgPreview'
import type { GitFileDiff } from '../../../types/chat'
import type { WorkspaceFileTab, WorkspaceTab } from '../types'
import { isSvgPreviewablePath } from '../../../lib/svg-preview'

interface WorkspaceFileTabsPanelContentProps {
  activeTab: WorkspaceTab
  gitFileDiffs: readonly GitFileDiff[]
    hasRepository: boolean
  tabs: readonly WorkspaceTab[]
  onOpenMarkdownPreview?: () => void
  onOpenSvgPreview?: () => void
  onFileContentChange: (relativePath: string, content: string) => void
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

export const WorkspaceFileTabsPanelContent = memo(function WorkspaceFileTabsPanelContent({
  activeTab,
  gitFileDiffs,
  hasRepository,
  tabs,
  onOpenMarkdownPreview,
  onOpenSvgPreview,
  onFileContentChange,
  wordWrapEnabled,
}: WorkspaceFileTabsPanelContentProps) {
  if (activeTab.kind === 'markdown-preview') {
    if (activeTab.status === 'loading') {
      return (
        <div className="flex h-full min-h-[200px] items-center justify-center text-sm text-subtle-foreground">
          Loading preview...
        </div>
      )
    }

    if (activeTab.status === 'error') {
      return (
        <div className="h-full border-t border-danger-border bg-danger-surface px-4 py-3 text-sm text-danger-foreground">
          {activeTab.errorMessage ?? 'Failed to load preview.'}
        </div>
      )
    }

    return (
      <WorkspaceMarkdownPreview
        content={activeTab.content}
        fileName={activeTab.fileName}
        relativePath={activeTab.relativePath}
        isTruncated={activeTab.isTruncated}
      />
    )
  }

  if (activeTab.kind === 'svg-preview') {
    const sourceTab = tabs.find(
      (tab): tab is WorkspaceFileTab => isWorkspaceFileTab(tab) && tab.relativePath === activeTab.relativePath,
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
          {sourceTab.errorMessage ?? 'Failed to open file.'}
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
        {activeTab.errorMessage ?? 'Failed to open file.'}
      </div>
    )
  }

  if (activeTab.isBinary) {
    return (
      <div className="h-full border-t border-border bg-surface px-4 py-3 text-sm text-subtle-foreground">
        Binary file view is not supported for {activeTab.fileName}.
      </div>
    )
  }

  return (
    <WorkspaceFileEditor
      fileName={activeTab.fileName}
      gitFileDiff={findGitFileDiff(gitFileDiffs, activeTab.relativePath)}
        hasRepository={hasRepository}
      onOpenMarkdownPreview={onOpenMarkdownPreview}
      onOpenSvgPreview={isSvgPreviewablePath(activeTab.relativePath) ? onOpenSvgPreview : undefined}
      originalContent={activeTab.originalContent}
      value={activeTab.content}
      wordWrapEnabled={wordWrapEnabled}
      onChange={(nextValue) => onFileContentChange(activeTab.relativePath, nextValue)}
    />
  )
})
