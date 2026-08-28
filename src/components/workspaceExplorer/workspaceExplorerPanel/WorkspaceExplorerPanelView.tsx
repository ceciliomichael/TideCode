import { AlertCircle, ChevronRight, File, Folder, FolderOpen, X } from 'lucide-react'
import type { DragEvent as ReactDragEvent } from 'react'
import { useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { resolveFileIconConfig } from '../../../lib/fileIconResolver'
import { prefetchWorkspaceFile } from '../../../lib/workspaceFilePreviewCache'
import { preloadWorkspaceMonacoEditorView } from '../../../lib/workspaceMonacoPreload'
import type { WorkspaceExplorerEntry } from '../../../types/chat'
import { normalizeWorkspaceRootPath } from '../../../pages/chatInterface/chatWorkspaceClipboard'
import { buildExplorerGitStatusMap } from './workspaceExplorerGitStatus'
import type { WorkspaceExplorerPanelProps } from './workspaceExplorerPanelTypes'
import type { WorkspaceExplorerPanelState } from './useWorkspaceExplorerPanelState'
import { WorkspaceExplorerErrorDialog } from './WorkspaceExplorerErrorDialog'
import { WorkspaceExplorerEntryRow, type WorkspaceExplorerEntryRowActions } from './WorkspaceExplorerEntryRow'
import { ROOT_DIRECTORY_KEY, isPathWithinTarget, normalizeEntryPath } from './workspaceExplorerPanelUtils'

interface WorkspaceExplorerPanelViewProps extends WorkspaceExplorerPanelProps {
  panelState: WorkspaceExplorerPanelState
}

export function WorkspaceExplorerPanelView({
  activeFilePath,
  clipboardEntry,
  gitFileDiffs,
  isOpen,
  panelState,
  workspaceRootPath,
}: WorkspaceExplorerPanelViewProps) {
  const gitStatusByPath = useMemo(() => buildExplorerGitStatusMap(gitFileDiffs), [gitFileDiffs])
  const normalizedWorkspaceRootPath = workspaceRootPath ? normalizeWorkspaceRootPath(workspaceRootPath) : null
  const entryRowActionsRef = useRef<WorkspaceExplorerEntryRowActions>({
    handleDirectoryDragLeave: panelState.handleDirectoryDragLeave,
    handleDirectoryDragOver: panelState.handleDirectoryDragOver,
    handleDirectoryDrop: panelState.handleDirectoryDrop,
    handleEntryClick: panelState.handleEntryClick,
    handleEntryDragEnd: panelState.handleEntryDragEnd,
    handleEntryDragStart: panelState.handleEntryDragStart,
    handleExternalDragLeave: panelState.handleExternalDragLeave,
    handleExternalDragOver: panelState.handleExternalDragOver,
    handleExternalDrop: panelState.handleExternalDrop,
    openContextMenu: panelState.openContextMenu,
    prefetchPreviewFile: () => undefined,
  })
  entryRowActionsRef.current = {
    handleDirectoryDragLeave: panelState.handleDirectoryDragLeave,
    handleDirectoryDragOver: panelState.handleDirectoryDragOver,
    handleDirectoryDrop: panelState.handleDirectoryDrop,
    handleEntryClick: panelState.handleEntryClick,
    handleEntryDragEnd: panelState.handleEntryDragEnd,
    handleEntryDragStart: panelState.handleEntryDragStart,
    handleExternalDragLeave: panelState.handleExternalDragLeave,
    handleExternalDragOver: panelState.handleExternalDragOver,
    handleExternalDrop: panelState.handleExternalDrop,
    openContextMenu: panelState.openContextMenu,
    prefetchPreviewFile: (relativePath) => {
      if (!workspaceRootPath) {
        return
      }
      void preloadWorkspaceMonacoEditorView().catch(() => undefined)
      prefetchWorkspaceFile({ relativePath, workspaceRootPath }, { priority: true })
    },
  }

  function getDeleteActionLabel() {
    const targetEntry = panelState.contextMenuState?.targetEntry
    if (!targetEntry) {
      return 'Delete'
    }

    const selectedCount = panelState.selectedEntryPaths.size
    const isTargetSelected = panelState.selectedEntryPaths.has(targetEntry.relativePath)
    if (selectedCount > 1 && isTargetSelected) {
      return `Delete ${selectedCount} items`
    }

    return targetEntry.isDirectory ? 'Delete Folder' : 'Delete'
  }

  function isExternalFileDrag(event: ReactDragEvent<HTMLElement>) {
    const items = Array.from(event.dataTransfer.items)
    return Array.from(event.dataTransfer.types).includes('Files') || items.some((item) => item.kind === 'file')
  }

  function renderCreationRow(depth: number) {
    const draft = panelState.creationDraft
    if (!draft) {
      return null
    }

    const creationFileIconConfig = draft.isDirectory
      ? null
      : resolveFileIconConfig({ fileName: panelState.creationName })
    const CreationFileIcon = creationFileIconConfig?.icon

    return (
      <li
        key={`create-${draft.parentPath}-${draft.isDirectory ? 'folder' : 'file'}`}
        className="min-w-0"
        style={{ containIntrinsicSize: '32px', contentVisibility: 'auto' }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void panelState.submitCreateEntry()
          }}
          className="flex h-8 w-full min-w-0 items-center gap-1 bg-surface-muted px-2 text-left text-sm text-foreground"
          style={{ paddingLeft: `${Math.max(8, depth * 12 + 8)}px` }}
        >
          <span className="w-[14px] shrink-0" />
          {draft.isDirectory ? (
            <Folder size={14} className="shrink-0 text-subtle-foreground" />
          ) : CreationFileIcon ? (
            <CreationFileIcon
              size={14}
              className="shrink-0"
              style={{ color: creationFileIconConfig?.color }}
            />
          ) : (
            <File size={14} className="shrink-0 text-subtle-foreground" />
          )}
          <input
            ref={panelState.creationInputRef}
            value={panelState.creationName}
            onChange={(event) => panelState.onCreationNameChange(event.target.value)}
            onBlur={() => {
              if (panelState.isSubmittingCreationRef.current) {
                return
              }
              if (panelState.creationName.trim().length === 0) {
                panelState.cancelCreateEntry()
                return
              }
              void panelState.submitCreateEntry()
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                panelState.cancelCreateEntry()
              }
            }}
            placeholder={draft.isDirectory ? 'folder-name' : 'file-name'}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-subtle-foreground"
          />
        </form>
      </li>
    )
  }

  function renderRenameRow(entry: WorkspaceExplorerEntry, depth: number) {
    const fileIconConfig = !entry.isDirectory ? resolveFileIconConfig({ fileName: entry.relativePath }) : null
    const FileIcon = fileIconConfig?.icon

    return (
      <li
        key={`rename-${entry.relativePath}`}
        className="min-w-0"
        style={{ containIntrinsicSize: '32px', contentVisibility: 'auto' }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void panelState.submitRenameEntry()
          }}
          className="flex h-8 w-full min-w-0 items-center gap-1 bg-surface-muted px-2 text-left text-sm text-foreground"
          style={{ paddingLeft: `${Math.max(8, depth * 12 + 8)}px` }}
        >
          {entry.isDirectory ? (
            <ChevronRight size={14} className="shrink-0 opacity-0" />
          ) : (
            <span className="w-[14px] shrink-0" />
          )}
          {entry.isDirectory ? (
            <Folder size={14} className="shrink-0 text-subtle-foreground" />
          ) : FileIcon ? (
            <FileIcon
              size={14}
              className="shrink-0"
              style={{ color: fileIconConfig?.color }}
            />
          ) : (
            <File size={14} className="shrink-0 text-subtle-foreground" />
          )}
          <input
            ref={panelState.renameInputRef}
            value={panelState.renameName}
            onChange={(event) => panelState.onRenameNameChange(event.target.value)}
            onBlur={() => {
              if (panelState.isSubmittingRenameRef.current) {
                return
              }
              if (panelState.renameName.trim().length === 0) {
                panelState.cancelRenameEntry()
                return
              }
              void panelState.submitRenameEntry()
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                panelState.cancelRenameEntry()
              }
            }}
            placeholder={entry.isDirectory ? 'folder-name' : 'file-name'}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-subtle-foreground"
          />
        </form>
      </li>
    )
  }

  function renderEntries(entries: readonly WorkspaceExplorerEntry[], depth: number): JSX.Element[] {
    return entries.flatMap((entry) => {
      const isDirectory = entry.isDirectory
      const entryPath = normalizeEntryPath(entry.relativePath)
      const normalizedActiveFilePath = activeFilePath ? normalizeEntryPath(activeFilePath) : null
      const isRenamingEntry = panelState.renameDraft?.entry.relativePath === entry.relativePath
      const isExpanded = isDirectory && panelState.expandedDirectories.has(entryPath)
      const isLoading = isDirectory && panelState.loadingDirectories.has(entryPath)
      const isDeleting = panelState.deletingEntryPaths.has(entry.relativePath)
      const isActiveFile = !isDirectory && normalizedActiveFilePath !== null && normalizedActiveFilePath === entryPath
      const isContextTarget = panelState.contextMenuState?.targetEntry?.relativePath === entry.relativePath
      const isSelectedEntry =
        panelState.selectedEntryPaths.has(entry.relativePath) ||
        panelState.selectedEntryPaths.has(entryPath)
      const isActiveFileSelection = isActiveFile && isSelectedEntry
      const isGitignoredEntry = entry.isGitignored === true
      const activeDropTarget = panelState.dropTargetDirectoryPath
      const isDropTarget =
        activeDropTarget !== null &&
        activeDropTarget !== ROOT_DIRECTORY_KEY &&
        isPathWithinTarget(entry.relativePath, activeDropTarget)
      const gitStatus = gitStatusByPath.get(entryPath)
      const isCutEntry =
        clipboardEntry?.mode === 'cut' &&
        normalizedWorkspaceRootPath !== null &&
        normalizeWorkspaceRootPath(clipboardEntry.sourceWorkspaceRootPath) === normalizedWorkspaceRootPath &&
        clipboardEntry.relativePaths.some((clipboardPath) => isPathWithinTarget(entry.relativePath, clipboardPath))
      const nestedEntries = isDirectory ? panelState.directoryEntriesByPath[entryPath] ?? [] : []
      if (isRenamingEntry) {
        return [renderRenameRow(entry, depth)]
      }

      const row = (
        <WorkspaceExplorerEntryRow
          key={entry.relativePath}
          actionsRef={entryRowActionsRef}
          depth={depth}
          entry={entry}
          gitStatus={gitStatus}
          isActiveFile={isActiveFileSelection}
          isContextTarget={isContextTarget}
          isCutEntry={isCutEntry}
          isDropTarget={isDropTarget}
          isDeleting={isDeleting}
          isExpanded={isExpanded}
          isGitignoredEntry={isGitignoredEntry}
          isLoading={isLoading}
          isSelectedEntry={isSelectedEntry}
          isSelectionFocused={panelState.isExplorerFocused}
        />
      )

      if (!isDirectory || !isExpanded) {
        return [row]
      }

      const creationRow =
        panelState.creationDraft && entryPath === normalizeEntryPath(panelState.creationDraft.parentPath)
          ? renderCreationRow(depth + 1)
          : null

      return [row, ...renderEntries(nestedEntries, depth + 1), ...(creationRow ? [creationRow] : [])]
    })
  }

  const showExplorerTree = panelState.rootEntries.length > 0 || Boolean(panelState.creationDraft)

  return (
    <aside
      className={[
        'non-selectable-ui relative flex h-full min-w-0 shrink-0 flex-col overflow-hidden border-l border-border bg-background max-md:hidden',
        isOpen ? 'pointer-events-auto' : 'pointer-events-none invisible',
      ].join(' ')}
      aria-hidden={!isOpen}
      style={{ width: isOpen ? `${panelState.renderedWidth}px` : '0px' }}
    >
      <div className="flex h-11 items-center justify-between pl-5 pr-3">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-subtle-foreground">Explorer</p>
      </div>
      <div
        ref={panelState.treeContainerRef}
        className={[
          'min-h-0 flex flex-1 flex-col overflow-y-auto focus:outline-none',
          panelState.dropTargetDirectoryPath === ROOT_DIRECTORY_KEY ? 'bg-surface/60' : '',
        ].join(' ')}
        tabIndex={0}
        onPasteCapture={(event) => {
          void panelState.handleExplorerPaste(event)
        }}
        onClick={panelState.handleExplorerBackgroundClick}
        onContextMenu={(event) => panelState.openContextMenu(event, null)}
        onKeyDownCapture={panelState.handleTreeKeyDown}
        onDragOverCapture={panelState.handleExplorerDragOver}
        onDragLeave={panelState.handleExplorerDragLeave}
        onDragOver={(event) => {
          if (event.target !== event.currentTarget) {
            return
          }
          if (isExternalFileDrag(event)) {
            panelState.handleExternalDragOver(event, ROOT_DIRECTORY_KEY)
            return
          }
          panelState.handleDirectoryDragOver(event, ROOT_DIRECTORY_KEY)
        }}
        onDrop={(event) => {
          if (event.target !== event.currentTarget) {
            return
          }
          if (isExternalFileDrag(event)) {
            void panelState.handleExternalDrop(event, ROOT_DIRECTORY_KEY)
            return
          }
          panelState.handleDirectoryDrop(event, ROOT_DIRECTORY_KEY)
        }}
      >
        {!panelState.isWorkspaceConfigured ? (
          <div className="flex flex-1 items-center justify-center px-4 py-6 text-center">
            <div className="flex max-w-[240px] flex-col items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-muted text-subtle-foreground">
                <FolderOpen size={22} />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">Explorer is waiting</p>
                <p className="text-sm leading-6 text-subtle-foreground">
                  Select a workspace folder to browse files here.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <>
            {panelState.errorMessage ? (
              <div
                role="alert"
                aria-live="assertive"
                className="mx-3 mt-2 flex shrink-0 items-start gap-2 rounded-xl border border-danger-border bg-danger-surface px-3 py-2 text-sm text-danger-foreground"
              >
                <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 break-words">{panelState.errorMessage}</span>
                <button
                  type="button"
                  aria-label="Dismiss explorer error"
                  onClick={panelState.clearErrorMessage}
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-danger-foreground transition-colors hover:bg-danger-surface hover:text-danger-foreground-hover"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
            ) : null}
            {!showExplorerTree ? (
          <div
            className="flex flex-1 items-center justify-center px-4 py-6 text-center"
            onDragOver={(event) => {
              if (isExternalFileDrag(event)) {
                panelState.handleExternalDragOver(event, ROOT_DIRECTORY_KEY)
                return
              }
              panelState.handleDirectoryDragOver(event, ROOT_DIRECTORY_KEY)
            }}
            onDragLeave={(event) => {
              if (isExternalFileDrag(event)) {
                panelState.handleExternalDragLeave(event, ROOT_DIRECTORY_KEY)
                return
              }
              panelState.handleDirectoryDragLeave(event, ROOT_DIRECTORY_KEY)
            }}
            onDrop={(event) => {
              if (isExternalFileDrag(event)) {
                void panelState.handleExternalDrop(event, ROOT_DIRECTORY_KEY)
                return
              }
              panelState.handleDirectoryDrop(event, ROOT_DIRECTORY_KEY)
            }}
          >
            <div className="flex max-w-[240px] flex-col items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-muted text-subtle-foreground">
                <FolderOpen size={22} />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">No files found</p>
                <p className="text-sm leading-6 text-subtle-foreground">
                  This workspace is empty. Add a file or folder to start browsing here.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <ul
            className="py-2"
            onClick={panelState.handleExplorerBackgroundClick}
            onDragOver={(event) => {
              if (event.target !== event.currentTarget) {
                return
              }
              if (isExternalFileDrag(event)) {
                panelState.handleExternalDragOver(event, ROOT_DIRECTORY_KEY)
                return
              }
              panelState.handleDirectoryDragOver(event, ROOT_DIRECTORY_KEY)
            }}
            onDragLeave={(event) => {
              if (event.target !== event.currentTarget) {
                return
              }
              if (isExternalFileDrag(event)) {
                panelState.handleExternalDragLeave(event, ROOT_DIRECTORY_KEY)
                return
              }
              panelState.handleDirectoryDragLeave(event, ROOT_DIRECTORY_KEY)
            }}
            onDrop={(event) => {
              if (event.target !== event.currentTarget) {
                return
              }
              if (isExternalFileDrag(event)) {
                void panelState.handleExternalDrop(event, ROOT_DIRECTORY_KEY)
                return
              }
              panelState.handleDirectoryDrop(event, ROOT_DIRECTORY_KEY)
            }}
          >
            {renderEntries(panelState.rootEntries, 0)}
            {panelState.creationDraft && normalizeEntryPath(panelState.creationDraft.parentPath) === ROOT_DIRECTORY_KEY
              ? renderCreationRow(0)
              : null}
          </ul>
            )}
          </>
        )}
      </div>
      {panelState.isDraggingExplorerEntry ? (
        <div
          aria-hidden="true"
          className="absolute bottom-0 right-0 top-11 z-40 w-6 cursor-ns-resize border-l border-border/70 bg-surface-muted/80"
          onDragOver={panelState.handleExplorerScrollbarDragOver}
          onDrop={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
        />
      ) : null}
      {panelState.contextMenuState
        ? createPortal(
            <div
              ref={panelState.contextMenuRef}
              role="menu"
              aria-label="Explorer actions"
              data-floating-menu-root="true"
              className="non-selectable-ui fixed z-[1200] min-w-[210px] overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-soft"
              style={panelState.contextMenuStyle}
            >
              {!panelState.contextMenuState.targetEntry || panelState.contextMenuState.targetEntry.isDirectory ? (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => panelState.startCreateEntry(false)}
                    className="flex h-10 w-full items-center rounded-lg px-2.5 text-left text-sm text-foreground transition-colors hover:bg-surface-muted"
                  >
                    New File
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => panelState.startCreateEntry(true)}
                    className="flex h-10 w-full items-center rounded-lg px-2.5 text-left text-sm text-foreground transition-colors hover:bg-surface-muted"
                  >
                    New Folder
                  </button>
                  <div className="my-1 h-px bg-border" />
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() =>
                      void panelState.submitClipboardContents(
                        panelState.contextMenuState?.targetEntry?.isDirectory
                          ? panelState.contextMenuState.targetEntry.relativePath
                          : ROOT_DIRECTORY_KEY,
                      )
                    }
                    className="flex h-10 w-full items-center rounded-lg px-2.5 text-left text-sm text-foreground transition-colors hover:bg-surface-muted"
                  >
                    Paste
                  </button>
                </>
              ) : null}
              {panelState.contextMenuState.targetEntry?.isDirectory ? (
                <>
                  <div className="my-1 h-px bg-border" />
                  <button
                    type="button"
                    role="menuitem"
                    onClick={panelState.requestDeleteEntry}
                    className="flex h-10 w-full items-center rounded-lg px-2.5 text-left text-sm text-danger-foreground transition-colors hover:bg-danger-surface"
                  >
                    {getDeleteActionLabel()}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={panelState.requestRenameEntry}
                    className="flex h-10 w-full items-center rounded-lg px-2.5 text-left text-sm text-foreground transition-colors hover:bg-surface-muted"
                  >
                    Rename
                  </button>
                </>
              ) : null}
              {panelState.contextMenuState.targetEntry && !panelState.contextMenuState.targetEntry.isDirectory ? (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={panelState.requestDeleteEntry}
                    className="flex h-10 w-full items-center rounded-lg px-2.5 text-left text-sm text-danger-foreground transition-colors hover:bg-danger-surface"
                  >
                    {getDeleteActionLabel()}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={panelState.requestRenameEntry}
                    className="flex h-10 w-full items-center rounded-lg px-2.5 text-left text-sm text-foreground transition-colors hover:bg-surface-muted"
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => panelState.requestCopyOrCutEntry('cut')}
                    className="flex h-10 w-full items-center rounded-lg px-2.5 text-left text-sm text-foreground transition-colors hover:bg-surface-muted"
                  >
                    Cut
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => panelState.requestCopyOrCutEntry('copy')}
                    className="flex h-10 w-full items-center rounded-lg px-2.5 text-left text-sm text-foreground transition-colors hover:bg-surface-muted"
                  >
                    Copy
                  </button>
                </>
              ) : null}
              {panelState.contextMenuState.targetEntry ? (
                <>
                  <div className="my-1 h-px bg-border" />
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => void panelState.copyContextEntryPath('absolute')}
                    className="flex h-10 w-full items-center rounded-lg px-2.5 text-left text-sm text-foreground transition-colors hover:bg-surface-muted"
                  >
                    Copy Path
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => void panelState.copyContextEntryPath('relative')}
                    className="flex h-10 w-full items-center rounded-lg px-2.5 text-left text-sm text-foreground transition-colors hover:bg-surface-muted"
                  >
                    Copy Relative Path
                  </button>
                </>
              ) : null}
            </div>,
            document.body,
          )
        : null}
      {panelState.errorDialogState ? (
        <WorkspaceExplorerErrorDialog
          onClose={panelState.closeErrorDialog}
          state={panelState.errorDialogState}
        />
      ) : null}
      {isOpen ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize explorer panel"
          onPointerDown={panelState.handleResizePointerDown}
          className="absolute inset-y-0 left-0 z-20 w-3 -translate-x-1/2 cursor-col-resize"
        />
      ) : null}
    </aside>
  )
}
