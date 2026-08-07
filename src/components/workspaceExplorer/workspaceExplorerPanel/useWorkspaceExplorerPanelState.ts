import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { WorkspaceExplorerEntry } from '../../../types/chat'
import type { WorkspaceExplorerPanelProps } from './workspaceExplorerPanelTypes'
import {
  ROOT_DIRECTORY_KEY,
  normalizeEntryPath,
} from './workspaceExplorerPanelUtils'
import { toUserFacingErrorMessage } from '../../../lib/userFacingError'
import { useWorkspaceExplorerContextMenu } from './useWorkspaceExplorerContextMenu'
import { useWorkspaceExplorerCreation } from './useWorkspaceExplorerCreation'
import { useWorkspaceExplorerDeleteDialog } from './useWorkspaceExplorerDeleteDialog'
import { useWorkspaceExplorerDragScroll } from './useWorkspaceExplorerDragScroll'
import { useWorkspaceExplorerResize } from './useWorkspaceExplorerResize'
import { useWorkspaceExplorerUndoStack } from './useWorkspaceExplorerUndoStack'
import { useWorkspaceExplorerTransfers } from './useWorkspaceExplorerTransfers'
import { useWorkspaceExplorerSelection } from './useWorkspaceExplorerSelection'
import { useWorkspaceExplorerRename } from './useWorkspaceExplorerRename'
import { useWorkspaceExplorerTree } from './useWorkspaceExplorerTree'
import { findLoadedExplorerEntry } from './workspaceExplorerSelectionUtils'
import type { WorkspaceExplorerErrorDialogState } from './workspaceExplorerPanelTypes'

export function useWorkspaceExplorerPanelState({
  activeFilePath,
  clipboardEntry,
  isOpen,
  onCopyEntry,
  onCreateEntry,
  onCutEntry,
  onDeleteEntry,
  onImportEntry,
  onMoveEntry,
  onOpenFile,
  onPasteEntry,
  onRenameEntry,
  onWidthChange,
  onWidthCommit,
  width,
  workspaceRootPath,
}: WorkspaceExplorerPanelProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [errorDialogState, setErrorDialogState] = useState<WorkspaceExplorerErrorDialogState | null>(null)
  const [dropTargetDirectoryPath, setDropTargetDirectoryPath] = useState<string | null>(null)
  const [selectedEntryPaths, setSelectedEntryPaths] = useState<Set<string>>(() => new Set())
  const [selectionDirectoryPath, setSelectionDirectoryPath] = useState<string>(ROOT_DIRECTORY_KEY)
  const [isDraggingExplorerEntry, setIsDraggingExplorerEntry] = useState(false)
  const draggedEntriesRef = useRef<WorkspaceExplorerEntry[]>([])
  const selectionAnchorEntryPathRef = useRef<string | null>(null)
  const isExplorerEditingRef = useRef(false)
  const pendingExplorerReloadRef = useRef(false)
  const isWorkspaceConfigured = typeof workspaceRootPath === 'string' && workspaceRootPath.trim().length > 0
  const clearErrorMessage = useCallback(() => {
    setErrorMessage(null)
  }, [])
  const closeErrorDialog = useCallback(() => {
    setErrorDialogState(null)
  }, [])
  const showErrorDialog = useCallback((state: WorkspaceExplorerErrorDialogState) => {
    setErrorDialogState(state)
  }, [])

  const {
    closeContextMenu,
    contextMenuRef,
    contextMenuState,
    contextMenuStyle,
    openContextMenu,
  } = useWorkspaceExplorerContextMenu({
    isWorkspaceConfigured,
    selectedEntryPaths,
    selectionAnchorEntryPathRef,
    setSelectedEntryPaths,
    setSelectionDirectoryPath,
  })
  const {
    handleResizePointerDown,
    isResizing,
    renderedWidth,
  } = useWorkspaceExplorerResize({
    isOpen,
    onWidthChange,
    onWidthCommit,
    width,
  })
  const {
    handleExplorerDragLeave,
    handleExplorerDragOver,
    handleExplorerScrollbarDragOver,
    stopDragScroll,
    treeContainerRef,
    updateDragScroll,
  } = useWorkspaceExplorerDragScroll({
    draggedEntriesRef,
  })

  const {
    directoryEntriesByPath,
    expandedDirectories,
    loadDirectory,
    loadingDirectories,
    reloadExplorerTree,
    resetTree,
    rootEntries,
    setExpandedDirectories,
  } = useWorkspaceExplorerTree({
    activeFilePath,
    isExplorerEditingRef,
    isOpen,
    pendingExplorerReloadRef,
    setErrorMessage,
    treeContainerRef,
    workspaceRootPath,
  })

  const undoStack = useWorkspaceExplorerUndoStack({
    workspaceRootPath,
    reloadExplorerTree,
  })

  const replayPendingExplorerReload = useCallback(() => {
    if (!pendingExplorerReloadRef.current) {
      return
    }

    pendingExplorerReloadRef.current = false
    void reloadExplorerTree({ force: true })
  }, [reloadExplorerTree])

  const runContextAction = useCallback(
    async (action: () => Promise<void>, shouldReload = true) => {
      closeContextMenu()
      try {
        await action()
        setErrorMessage(null)
        if (shouldReload) {
          await reloadExplorerTree()
        }
        return true
      } catch (error) {
        setErrorMessage(toUserFacingErrorMessage(error, 'Explorer action failed.'))
        return false
      }
    },
    [closeContextMenu, reloadExplorerTree],
  )

  const onDeleteEntryWithUndo = useCallback(
    async (relativePaths: string[]) => {
      const entriesForUndo = relativePaths.map((relativePath) => {
        const entry = findLoadedExplorerEntry(rootEntries, directoryEntriesByPath, relativePath)
        return { relativePath, isDirectory: entry?.isDirectory ?? false }
      })
      await undoStack.recordDeleteEntries(entriesForUndo)
      await onDeleteEntry(relativePaths)
    },
    [onDeleteEntry, undoStack, rootEntries, directoryEntriesByPath],
  )

  const {
    closeDeleteDialog,
    confirmDeleteEntry,
    deleteDialogState,
    isSubmittingDeleteEntry,
    openDeleteDialog,
    resetDeleteDialog,
  } = useWorkspaceExplorerDeleteDialog({
    closeContextMenu,
    directoryEntriesByPath,
    onDeleteEntry: onDeleteEntryWithUndo,
    runContextAction,
  })


  const {
    cancelCreateEntry,
    creationDraft,
    creationInputRef,
    creationName,
    isSubmittingCreationRef,
    onCreationNameChange,
    resetCreation,
    startCreateEntry,
    submitCreateEntry,
  } = useWorkspaceExplorerCreation({
    closeContextMenu,
    contextMenuState,
    directoryEntriesByPath,
    loadDirectory,
    onCreateEntry,
    onOpenFile,
    showErrorDialog,
    setErrorMessage,
    setExpandedDirectories,
  })

  const {
    cancelRenameEntry,
    isSubmittingRenameRef,
    onRenameNameChange,
    prepareForCreation,
    renameDraft,
    renameInputRef,
    renameName,
    requestRenameEntry,
    resetRename,
    submitRenameEntry,
  } = useWorkspaceExplorerRename({
    closeContextMenu,
    contextMenuState,
    creationDraft,
    isExplorerEditingRef,
    isSubmittingCreationRef,
    loadDirectory,
    onRenameEntry,
    replayPendingExplorerReload,
    resetCreation,
    selectionAnchorEntryPathRef,
    setErrorMessage,
    setExpandedDirectories,
    setSelectedEntryPaths,
    setSelectionDirectoryPath,
    undoStack,
  })

  const startCreateEntryWithDeferredReloads = useCallback(
    (isDirectory: boolean) => {
      prepareForCreation()
      startCreateEntry(isDirectory)
    },
    [prepareForCreation, startCreateEntry],
  )

  const cancelCreateEntryWithPendingReload = useCallback(() => {
    cancelCreateEntry()
    isExplorerEditingRef.current = false
    replayPendingExplorerReload()
  }, [cancelCreateEntry, replayPendingExplorerReload])

  useEffect(() => {
    const wasEditing = isExplorerEditingRef.current
    const isEditing = Boolean(creationDraft || renameDraft)
    isExplorerEditingRef.current = isEditing

    if (!wasEditing || isEditing || !pendingExplorerReloadRef.current) {
      return
    }

    replayPendingExplorerReload()
  }, [creationDraft, renameDraft, replayPendingExplorerReload])

  useEffect(() => {
    resetTree()
    resetCreation()
    resetRename()
    setErrorMessage(null)
    setErrorDialogState(null)
    resetDeleteDialog()
    setSelectedEntryPaths(new Set())
    setSelectionDirectoryPath(ROOT_DIRECTORY_KEY)
    closeContextMenu()
    isExplorerEditingRef.current = false
    pendingExplorerReloadRef.current = false
  }, [closeContextMenu, resetCreation, resetDeleteDialog, resetRename, resetTree, workspaceRootPath])

  useEffect(() => {
    if (!activeFilePath) {
      setSelectedEntryPaths((current) => {
        if (current.size === 0) {
          return current
        }
        return new Set()
      })
      return
    }

    const normalizedActivePath = normalizeEntryPath(activeFilePath)

    setSelectedEntryPaths((current) => {
      if (current.size === 1 && (current.has(activeFilePath) || current.has(normalizedActivePath))) {
        return current
      }
      return new Set([normalizedActivePath])
    })
  }, [activeFilePath])

  useEffect(() => {
    if (isOpen) {
      return
    }

    closeContextMenu()
    resetDeleteDialog()
    closeErrorDialog()
  }, [closeContextMenu, closeErrorDialog, isOpen, resetDeleteDialog])

  const {
    handleDirectoryDragLeave,
    handleDirectoryDragOver,
    handleDirectoryDrop,
    handleEntryDragEnd,
    handleEntryDragStart,
    handleExplorerPaste,
    handleExternalDragLeave,
    handleExternalDragOver,
    handleExternalDrop,
    submitImportEntries,
    submitMoveEntry,
    submitPasteEntry,
  } = useWorkspaceExplorerTransfers({
    clipboardEntry,
    closeContextMenu,
    directoryEntriesByPath,
    draggedEntriesRef,
    dropTargetDirectoryPath,
    loadDirectory,
    onImportEntry,
    onMoveEntry,
    onPasteEntry,
    recordMove: undoStack.recordMove,
    reloadExplorerTree,
    rootEntries,
    selectedEntryPaths,
    selectionDirectoryPath,
    setDropTargetDirectoryPath,
    setErrorMessage,
    setIsDraggingExplorerEntry,
    setSelectedEntryPaths,
    stopDragScroll,
    updateDragScroll,
    workspaceRootPath,
  })

  const requestDeleteEntry = useCallback(() => {
    const targetEntry = contextMenuState?.targetEntry
    if (!targetEntry) {
      closeContextMenu()
      return
    }

    const targetRelativePaths = selectedEntryPaths.has(targetEntry.relativePath)
      ? Array.from(selectedEntryPaths)
      : [targetEntry.relativePath]

    openDeleteDialog(targetRelativePaths, targetEntry)
  }, [closeContextMenu, contextMenuState, openDeleteDialog, selectedEntryPaths])

  const requestCopyOrCutEntries = useCallback(
    (relativePaths: readonly string[], mode: 'copy' | 'cut') => {
      const normalizedRelativePaths = Array.from(
        new Set(relativePaths.map((relativePath) => relativePath.trim()).filter((relativePath) => relativePath.length > 0)),
      )
      if (normalizedRelativePaths.length === 0) {
        closeContextMenu()
        return
      }

      void runContextAction(
        async () => {
          if (mode === 'copy') {
            await onCopyEntry(normalizedRelativePaths)
            return
          }
          await onCutEntry(normalizedRelativePaths)
        },
        false,
      )
    },
    [closeContextMenu, onCopyEntry, onCutEntry, runContextAction],
  )

  const requestCopyOrCutEntry = useCallback(
    (mode: 'copy' | 'cut') => {
      const targetEntry = contextMenuState?.targetEntry
      if (!targetEntry) {
        closeContextMenu()
        return
      }

      requestCopyOrCutEntries(
        selectedEntryPaths.has(targetEntry.relativePath) ? Array.from(selectedEntryPaths) : [targetEntry.relativePath],
        mode,
      )
    },
    [closeContextMenu, contextMenuState, requestCopyOrCutEntries, selectedEntryPaths],
  )

  const {
    handleEntryClick,
    handleExplorerBackgroundClick,
    handleTreeKeyDown,
    toggleDirectory,
  } = useWorkspaceExplorerSelection({
    activeFilePath,
    clipboardEntry,
    directoryEntriesByPath,
    expandedDirectories,
    loadDirectory,
    onOpenFile,
    openDeleteDialog,
    requestCopyOrCutEntries,
    rootEntries,
    selectedEntryPaths,
    selectionAnchorEntryPathRef,
    selectionDirectoryPath,
    setErrorMessage,
    setExpandedDirectories,
    setSelectedEntryPaths,
    setSelectionDirectoryPath,
    submitImportEntries,
    submitPasteEntry,
    undoStack,
  })

  return {
    cancelCreateEntry: cancelCreateEntryWithPendingReload,
    cancelRenameEntry,
    contextMenuRef,
    contextMenuState,
    contextMenuStyle,
    creationDraft,
    creationInputRef,
    creationName,
    renameDraft,
    renameInputRef,
    renameName,
    directoryEntriesByPath,
    dropTargetDirectoryPath,
    errorMessage,
    errorDialogState,
    clearErrorMessage,
    closeErrorDialog,
    expandedDirectories,
    closeDeleteDialog,
    handleDirectoryDragLeave,
    handleDirectoryDragOver,
    handleDirectoryDrop,
    handleExternalDragLeave,
    handleExternalDragOver,
    handleExternalDrop,
    handleEntryDragEnd,
    handleEntryDragStart,
    handleEntryClick,
    handleExplorerBackgroundClick,
    handleExplorerPaste,
    handleExplorerDragLeave,
    handleExplorerDragOver,
    handleExplorerScrollbarDragOver,
    handleResizePointerDown,
    isDraggingExplorerEntry,
    isResizing,
    isSubmittingDeleteEntry,
    isSubmittingCreationRef,
    isSubmittingRenameRef,
    isWorkspaceConfigured,
    loadingDirectories,
    onCreationNameChange,
    onRenameNameChange,
    deleteDialogState,
    openContextMenu,
    renderedWidth,
    confirmDeleteEntry,
    requestCopyOrCutEntry,
    requestDeleteEntry,
    requestRenameEntry,
    rootEntries,
    selectedEntryPaths,
    startCreateEntry: startCreateEntryWithDeferredReloads,
    submitCreateEntry,
    submitRenameEntry,
    submitMoveEntry,
    submitPasteEntry,
    handleTreeKeyDown,
    treeContainerRef,
    toggleDirectory,
  }
}

export type WorkspaceExplorerPanelState = ReturnType<typeof useWorkspaceExplorerPanelState>
