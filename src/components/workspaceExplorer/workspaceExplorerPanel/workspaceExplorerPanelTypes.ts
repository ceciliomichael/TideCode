import type { WorkspaceExplorerEntry } from '../../../types/chat'
import type { GitFileDiff } from '../../../types/chat'
import type { WorkspaceClipboardEntry } from '../workspaceClipboardTypes'

export interface WorkspaceExplorerPanelProps {
  activeFilePath: string | null
  clipboardEntry: WorkspaceClipboardEntry | null
  gitFileDiffs: readonly GitFileDiff[]
  isOpen: boolean
  onCopyEntry: (relativePaths: string[]) => Promise<void>
  onCreateEntry: (relativePath: string, isDirectory: boolean) => Promise<void>
  onCutEntry: (relativePaths: string[]) => Promise<void>
  onDeleteEntry: (relativePaths: string[]) => Promise<void>
  onMoveEntry: (relativePath: string, targetDirectoryRelativePath: string) => Promise<void>
  onImportEntry: (sourcePath: string, targetDirectoryRelativePath: string) => Promise<void>
  onOpenFile: (relativePath: string) => void
  onPasteEntry: (targetDirectoryRelativePath: string) => Promise<void>
  onRenameEntry: (relativePath: string, nextRelativePath: string) => Promise<void>
  onWidthChange: (nextWidth: number) => void
  onWidthCommit: (nextWidth: number) => void
  width: number
  workspaceRootPath: string | null
}

export interface WorkspaceExplorerContextMenuState {
  position: {
    x: number
    y: number
  }
  targetEntry: WorkspaceExplorerEntry | null
}

export interface WorkspaceExplorerContextMenuDimensions {
  height: number
  width: number
}

export interface WorkspaceExplorerDeleteDialogState {
  primaryEntryKind: 'file' | 'folder'
  primaryEntryName: string
  targetRelativePaths: string[]
}

export interface PendingExplorerCreation {
  isDirectory: boolean
  parentPath: string
}
