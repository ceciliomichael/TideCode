import { ChevronRight, RefreshCw } from 'lucide-react'
import { memo, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, type RefObject } from 'react'
import { resolveFileIconConfig } from '../../../lib/fileIconResolver'
import { getPathDirname } from '../../../lib/pathPresentation'
import type { WorkspaceExplorerEntry } from '../../../types/chat'

export interface WorkspaceExplorerEntryRowActions {
  handleDirectoryDragLeave: (event: ReactDragEvent<HTMLElement>, targetDirectoryRelativePath: string) => void
  handleDirectoryDragOver: (event: ReactDragEvent<HTMLElement>, targetDirectoryRelativePath: string) => void
  handleDirectoryDrop: (event: ReactDragEvent<HTMLElement>, targetDirectoryRelativePath: string) => void
  handleEntryClick: (entry: WorkspaceExplorerEntry, event: ReactMouseEvent<HTMLButtonElement>) => void
  handleEntryDragEnd: () => void
  handleEntryDragStart: (event: ReactDragEvent<HTMLButtonElement>, entry: WorkspaceExplorerEntry) => void
  handleExternalDragLeave: (event: ReactDragEvent<HTMLElement>, targetDirectoryRelativePath: string) => void
  handleExternalDragOver: (event: ReactDragEvent<HTMLElement>, targetDirectoryRelativePath: string) => void
  handleExternalDrop: (event: ReactDragEvent<HTMLElement>, targetDirectoryRelativePath: string) => void
  openContextMenu: (event: ReactMouseEvent<HTMLElement>, targetEntry: WorkspaceExplorerEntry | null) => void
  prefetchPreviewFile: (relativePath: string) => void
}

interface WorkspaceExplorerEntryRowProps {
  actionsRef: RefObject<WorkspaceExplorerEntryRowActions>
  depth: number
  entry: WorkspaceExplorerEntry
  isActiveFile: boolean
  isContextTarget: boolean
  isCutEntry: boolean
  isDropTarget: boolean
  isExpanded: boolean
  isGitignoredEntry: boolean
  isLoading: boolean
  isSelectedEntry: boolean
  gitStatus?: 'modified' | 'untracked'
}

function isExternalFileDrag(event: ReactDragEvent<HTMLElement>) {
  return (
    Array.from(event.dataTransfer.types).includes('Files') ||
    Array.from(event.dataTransfer.items).some((item) => item.kind === 'file')
  )
}

export const WorkspaceExplorerEntryRow = memo(function WorkspaceExplorerEntryRow({
  actionsRef,
  depth,
  entry,
  isActiveFile,
  isContextTarget,
  isCutEntry,
  isDropTarget,
  isExpanded,
  isGitignoredEntry,
  isLoading,
  isSelectedEntry,
  gitStatus,
}: WorkspaceExplorerEntryRowProps) {
  const isDirectory = entry.isDirectory
  const entryPath = entry.relativePath
  const fileIconConfig = !isDirectory ? resolveFileIconConfig({ fileName: entry.relativePath }) : null
  const FileIcon = fileIconConfig?.icon
  const gitStatusTextClass = gitStatus === 'untracked' ? 'text-[#5D9F73]' : gitStatus === 'modified' ? 'text-[#C7904A]' : ''
  const rowStateClass = isSelectedEntry || isActiveFile || isContextTarget || isDropTarget
    ? 'bg-brand-soft text-foreground'
    : 'text-muted-foreground hover:bg-surface-muted hover:text-foreground'
  const targetDirectoryPath = isDirectory ? entryPath : getPathDirname(entryPath)

  return (
    <li
      className="min-w-0"
      style={{ containIntrinsicSize: '32px', contentVisibility: 'auto' }}
    >
      <button
        type="button"
        draggable
        onClick={(event) => actionsRef.current?.handleEntryClick(entry, event)}
        onContextMenu={(event) => actionsRef.current?.openContextMenu(event, entry)}
        onMouseEnter={() => {
          if (!isDirectory) {
            actionsRef.current?.prefetchPreviewFile(entry.relativePath)
          }
        }}
        onDragStart={(event) => actionsRef.current?.handleEntryDragStart(event, entry)}
        onDragEnd={() => actionsRef.current?.handleEntryDragEnd()}
        onDragOver={(event) => {
          if (isExternalFileDrag(event)) {
            actionsRef.current?.handleExternalDragOver(event, targetDirectoryPath)
            return
          }
          actionsRef.current?.handleDirectoryDragOver(event, targetDirectoryPath)
        }}
        onDragLeave={(event) => {
          if (isExternalFileDrag(event)) {
            actionsRef.current?.handleExternalDragLeave(event, targetDirectoryPath)
            return
          }
          actionsRef.current?.handleDirectoryDragLeave(event, targetDirectoryPath)
        }}
        onDrop={(event) => {
          if (isExternalFileDrag(event)) {
            void actionsRef.current?.handleExternalDrop(event, targetDirectoryPath)
            return
          }
          actionsRef.current?.handleDirectoryDrop(event, targetDirectoryPath)
        }}
        className={[
          'flex h-8 w-full min-w-0 items-center gap-1 rounded-none px-2 text-left text-sm transition-colors outline-none focus:outline-none focus-visible:outline-none',
          isCutEntry ? 'opacity-55' : '',
          rowStateClass,
        ].join(' ')}
        data-workspace-entry-path={entry.relativePath}
        aria-selected={isSelectedEntry || isActiveFile || isContextTarget}
        style={{ paddingLeft: `${Math.max(8, depth * 12 + 8)}px` }}
      >
        {isDirectory ? (
          <ChevronRight size={14} className={['shrink-0 transition-transform', isExpanded ? 'rotate-90' : ''].join(' ')} />
        ) : (
          <span className="w-[14px] shrink-0" />
        )}
        {!isDirectory && FileIcon ? (
          <FileIcon size={14} className="shrink-0" style={{ color: fileIconConfig?.color }} />
        ) : null}
        <span className={['truncate', isGitignoredEntry ? 'opacity-60' : '', gitStatusTextClass].join(' ')}>{entry.name}</span>
        {isLoading && !isExpanded ? (
          <RefreshCw size={12} className="ml-auto shrink-0 animate-spin text-subtle-foreground" />
        ) : null}
      </button>
    </li>
  )
}, areWorkspaceExplorerEntryRowPropsEqual)

function areWorkspaceExplorerEntryRowPropsEqual(
  left: WorkspaceExplorerEntryRowProps,
  right: WorkspaceExplorerEntryRowProps,
) {
  return (
    left.actionsRef === right.actionsRef &&
    left.depth === right.depth &&
    left.entry === right.entry &&
    left.isActiveFile === right.isActiveFile &&
    left.isContextTarget === right.isContextTarget &&
    left.isCutEntry === right.isCutEntry &&
    left.isDropTarget === right.isDropTarget &&
    left.isExpanded === right.isExpanded &&
    left.isGitignoredEntry === right.isGitignoredEntry &&
    left.isLoading === right.isLoading &&
    left.isSelectedEntry === right.isSelectedEntry &&
    left.gitStatus === right.gitStatus
  )
}
