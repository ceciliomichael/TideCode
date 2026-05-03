import { useCallback, useState } from 'react'
import type { WorkspaceExplorerEntry } from '../../../types/chat'
import { getPathBasename } from '../../../lib/pathPresentation'
import type { WorkspaceExplorerDeleteDialogState } from './workspaceExplorerPanelTypes'
import { ROOT_DIRECTORY_KEY } from './workspaceExplorerPanelUtils'
import { findLoadedExplorerEntry } from './workspaceExplorerSelectionUtils'

interface UseWorkspaceExplorerDeleteDialogOptions {
  closeContextMenu: () => void
  directoryEntriesByPath: Record<string, WorkspaceExplorerEntry[]>
  onDeleteEntry: (relativePaths: string[]) => Promise<void>
  runContextAction: (action: () => Promise<void>, shouldReload?: boolean) => Promise<boolean>
}

export function useWorkspaceExplorerDeleteDialog({
  closeContextMenu,
  directoryEntriesByPath,
  onDeleteEntry,
  runContextAction,
}: UseWorkspaceExplorerDeleteDialogOptions) {
  const [deleteDialogState, setDeleteDialogState] = useState<WorkspaceExplorerDeleteDialogState | null>(null)
  const [isSubmittingDeleteEntry, setIsSubmittingDeleteEntry] = useState(false)

  const closeDeleteDialog = useCallback(() => {
    if (isSubmittingDeleteEntry) {
      return
    }

    setDeleteDialogState(null)
  }, [isSubmittingDeleteEntry])

  const openDeleteDialog = useCallback(
    (targetRelativePaths: readonly string[], targetEntry: WorkspaceExplorerEntry | null) => {
      const normalizedRelativePaths = Array.from(
        new Set(targetRelativePaths.map((relativePath) => relativePath.trim()).filter((relativePath) => relativePath.length > 0)),
      )

      if (normalizedRelativePaths.length === 0) {
        closeContextMenu()
        return
      }

      const primaryEntry =
        targetEntry ??
        findLoadedExplorerEntry(directoryEntriesByPath[ROOT_DIRECTORY_KEY] ?? [], directoryEntriesByPath, normalizedRelativePaths[0]) ??
        null

      setDeleteDialogState({
        primaryEntryKind: primaryEntry?.isDirectory ? 'folder' : 'file',
        primaryEntryName: primaryEntry?.name ?? getPathBasename(normalizedRelativePaths[0]),
        targetRelativePaths: normalizedRelativePaths,
      })
      closeContextMenu()
    },
    [closeContextMenu, directoryEntriesByPath],
  )

  const confirmDeleteEntry = useCallback(async () => {
    if (!deleteDialogState) {
      return
    }

    setIsSubmittingDeleteEntry(true)
    try {
      const didDelete = await runContextAction(async () => {
        await onDeleteEntry(deleteDialogState.targetRelativePaths)
      })

      if (didDelete) {
        setDeleteDialogState(null)
      }
    } finally {
      setIsSubmittingDeleteEntry(false)
    }
  }, [deleteDialogState, onDeleteEntry, runContextAction])

  const resetDeleteDialog = useCallback(() => {
    setDeleteDialogState(null)
    setIsSubmittingDeleteEntry(false)
  }, [])

  return {
    closeDeleteDialog,
    confirmDeleteEntry,
    deleteDialogState,
    isSubmittingDeleteEntry,
    openDeleteDialog,
    resetDeleteDialog,
  }
}
