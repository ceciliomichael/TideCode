import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import type { WorkspaceExplorerEntry } from '../../../types/chat'
import { getPathBasename, getPathDirname } from '../../../lib/pathPresentation'
import type { PendingExplorerRename, WorkspaceExplorerPanelProps } from './workspaceExplorerPanelTypes'
import {
  ROOT_DIRECTORY_KEY,
  getAncestorDirectoryPaths,
  joinRelativePath,
  normalizeEntryPath,
  shouldSyncActiveFileAncestors,
  toDirectoryKey,
} from './workspaceExplorerPanelUtils'
import { getExternalClipboardFilePaths, getExternalFilePaths } from './workspaceExplorerDragUtils'
import { useWorkspaceExplorerContextMenu } from './useWorkspaceExplorerContextMenu'
import { useWorkspaceExplorerCreation } from './useWorkspaceExplorerCreation'
import { useWorkspaceExplorerDeleteDialog } from './useWorkspaceExplorerDeleteDialog'
import { useWorkspaceExplorerDragScroll } from './useWorkspaceExplorerDragScroll'
import { useWorkspaceExplorerResize } from './useWorkspaceExplorerResize'
import { useWorkspaceExplorerUndoStack } from './useWorkspaceExplorerUndoStack'
import {
  collectLoadedExplorerEntryPaths,
  findLoadedExplorerEntry,
  getDirectoryEntriesForSelection,
  getSelectionDirectoryPath,
  isTreeShortcutTarget,
} from './workspaceExplorerSelectionUtils'

interface ReloadExplorerTreeOptions {
  force?: boolean
}

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
  const [directoryEntriesByPath, setDirectoryEntriesByPath] = useState<Record<string, WorkspaceExplorerEntry[]>>({})
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(() => new Set())
  const [loadingDirectories, setLoadingDirectories] = useState<Set<string>>(() => new Set())
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [dropTargetDirectoryPath, setDropTargetDirectoryPath] = useState<string | null>(null)
  const [selectedEntryPaths, setSelectedEntryPaths] = useState<Set<string>>(() => new Set())
  const [selectionDirectoryPath, setSelectionDirectoryPath] = useState<string>(ROOT_DIRECTORY_KEY)
  const [isDraggingExplorerEntry, setIsDraggingExplorerEntry] = useState(false)
  const [renameDraft, setRenameDraft] = useState<PendingExplorerRename | null>(null)
  const [renameName, setRenameName] = useState('')
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const isSubmittingRenameRef = useRef(false)
  const lastSyncedActiveFileRef = useRef<{ workspacePath: string | null; filePath: string | null }>({
    workspacePath: null,
    filePath: null,
  })
  const draggedEntryRef = useRef<WorkspaceExplorerEntry | null>(null)
  const selectionAnchorEntryPathRef = useRef<string | null>(null)
  const isExplorerEditingRef = useRef(false)
  const pendingExplorerReloadRef = useRef(false)
  const isWorkspaceConfigured = typeof workspaceRootPath === 'string' && workspaceRootPath.trim().length > 0

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
    draggedEntryRef,
  })

  const loadDirectory = useCallback(
    async (relativePath?: string, options?: { hideError?: boolean }) => {
      if (!workspaceRootPath) {
        return
      }

      const targetPath = toDirectoryKey(relativePath)
      setLoadingDirectories((current) => new Set(current).add(targetPath))
      try {
        const entries = await window.echosphereWorkspace.listDirectory({
          relativePath: targetPath === ROOT_DIRECTORY_KEY ? undefined : targetPath,
          visibility: 'explorer',
          workspaceRootPath,
        })
        setDirectoryEntriesByPath((current) => ({
          ...current,
          [targetPath]: entries,
        }))
        setErrorMessage(null)
      } catch (error) {
        const errorText = error instanceof Error ? error.message : 'Failed to load workspace files.'
        if (targetPath !== ROOT_DIRECTORY_KEY && errorText.startsWith('Directory does not exist:')) {
          setDirectoryEntriesByPath((current) => {
            const nextState = { ...current }
            delete nextState[targetPath]
            return nextState
          })
          setExpandedDirectories((current) => {
            const nextState = new Set(current)
            nextState.delete(targetPath)
            return nextState
          })
          return
        }
        if (!options?.hideError) {
          setErrorMessage(errorText)
        }
      } finally {
        setLoadingDirectories((current) => {
          const nextState = new Set(current)
          nextState.delete(targetPath)
          return nextState
        })
      }
    },
    [workspaceRootPath],
  )

  const preserveTreeScrollDuring = useCallback(async (operation: () => Promise<void>) => {
    const treeContainer = treeContainerRef.current
    const previousScrollTop = treeContainer?.scrollTop ?? 0

    await operation()

    window.requestAnimationFrame(() => {
      const currentTreeContainer = treeContainerRef.current
      if (!currentTreeContainer) {
        return
      }

      currentTreeContainer.scrollTop = Math.min(
        previousScrollTop,
        Math.max(0, currentTreeContainer.scrollHeight - currentTreeContainer.clientHeight),
      )
    })
  }, [])

  const reloadExplorerTree = useCallback((options?: ReloadExplorerTreeOptions) => {
    if (isExplorerEditingRef.current && !options?.force) {
      pendingExplorerReloadRef.current = true
      return Promise.resolve()
    }

    const directoriesToReload = [ROOT_DIRECTORY_KEY, ...expandedDirectories]
    return preserveTreeScrollDuring(async () => {
      await Promise.all(directoriesToReload.map((directoryPath) => loadDirectory(directoryPath, { hideError: true })))
    })
  }, [expandedDirectories, loadDirectory, preserveTreeScrollDuring])
  const reloadExplorerTreeRef = useRef(reloadExplorerTree)

  useEffect(() => {
    reloadExplorerTreeRef.current = reloadExplorerTree
  }, [reloadExplorerTree])

  const undoStack = useWorkspaceExplorerUndoStack({
    workspaceRootPath,
    reloadExplorerTree,
  })

  const replayPendingExplorerReload = useCallback(() => {
    if (!pendingExplorerReloadRef.current) {
      return
    }

    pendingExplorerReloadRef.current = false
    void reloadExplorerTreeRef.current({ force: true })
  }, [])

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
        setErrorMessage(error instanceof Error ? error.message : 'Explorer action failed.')
        return false
      }
    },
    [closeContextMenu, reloadExplorerTree],
  )

  const onDeleteEntryWithUndo = useCallback(
    async (relativePaths: string[]) => {
      await undoStack.recordDeleteEntries(relativePaths)
      await onDeleteEntry(relativePaths)
    },
    [onDeleteEntry, undoStack],
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

  const rootEntries = directoryEntriesByPath[ROOT_DIRECTORY_KEY] ?? []

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
    setErrorMessage,
    setExpandedDirectories,
  })

  useEffect(() => {
    if (!renameDraft) {
      return
    }

    const animationFrameId = window.requestAnimationFrame(() => {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    })

    return () => {
      window.cancelAnimationFrame(animationFrameId)
    }
  }, [renameDraft])

  const startCreateEntryWithDeferredReloads = useCallback(
    (isDirectory: boolean) => {
      setRenameDraft(null)
      setRenameName('')
      isSubmittingRenameRef.current = false
      isExplorerEditingRef.current = true
      startCreateEntry(isDirectory)
    },
    [startCreateEntry],
  )

  const cancelCreateEntryWithPendingReload = useCallback(() => {
    cancelCreateEntry()
    isExplorerEditingRef.current = false
    replayPendingExplorerReload()
  }, [cancelCreateEntry, replayPendingExplorerReload])

  const cancelRenameEntry = useCallback(() => {
    isSubmittingRenameRef.current = false
    setRenameDraft(null)
    setRenameName('')
    isExplorerEditingRef.current = Boolean(creationDraft)
    if (!creationDraft) {
      replayPendingExplorerReload()
    }
  }, [creationDraft, replayPendingExplorerReload])

  const submitRenameEntry = useCallback(async () => {
    const draft = renameDraft
    if (!draft) {
      return
    }

    const nextName = renameName.trim()
    if (nextName.length === 0) {
      setErrorMessage('Name is required.')
      return
    }
    if (/[/\\]/u.test(nextName)) {
      setErrorMessage('Name cannot include path separators.')
      return
    }

    const parentPath = getPathDirname(draft.entry.relativePath)
    const nextRelativePath = joinRelativePath(parentPath, nextName)
    if (normalizeEntryPath(nextRelativePath) === normalizeEntryPath(draft.entry.relativePath)) {
      cancelRenameEntry()
      return
    }

    isSubmittingRenameRef.current = true
    try {
      await onRenameEntry(draft.entry.relativePath, nextRelativePath)
      undoStack.recordRename(draft.entry.relativePath, nextRelativePath, draft.entry.isDirectory)
      setErrorMessage(null)
      setSelectedEntryPaths(new Set([nextRelativePath]))
      setSelectionDirectoryPath(parentPath)
      selectionAnchorEntryPathRef.current = nextRelativePath
      if (draft.entry.isDirectory) {
        setExpandedDirectories((current) => {
          if (!current.has(draft.entry.relativePath)) {
            return current
          }

          const nextState = new Set(current)
          nextState.delete(draft.entry.relativePath)
          nextState.add(nextRelativePath)
          return nextState
        })
      }
      await loadDirectory(parentPath)
      setRenameDraft(null)
      setRenameName('')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to rename workspace entry.')
    } finally {
      isSubmittingRenameRef.current = false
      isExplorerEditingRef.current = Boolean(creationDraft)
      if (!creationDraft) {
        replayPendingExplorerReload()
      }
    }
  }, [
    cancelRenameEntry,
    creationDraft,
    loadDirectory,
    onRenameEntry,
    renameDraft,
    renameName,
    replayPendingExplorerReload,
    setExpandedDirectories,
    undoStack,
  ])

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
    setDirectoryEntriesByPath({})
    setExpandedDirectories(new Set())
    setLoadingDirectories(new Set())
    resetCreation()
    setRenameDraft(null)
    setRenameName('')
    isSubmittingRenameRef.current = false
    setErrorMessage(null)
    resetDeleteDialog()
    setSelectedEntryPaths(new Set())
    setSelectionDirectoryPath(ROOT_DIRECTORY_KEY)
    closeContextMenu()
    lastSyncedActiveFileRef.current = {
      workspacePath: null,
      filePath: null,
    }
    isExplorerEditingRef.current = false
    pendingExplorerReloadRef.current = false
  }, [closeContextMenu, resetCreation, resetDeleteDialog, workspaceRootPath])

  useEffect(() => {
    if (!isOpen || !workspaceRootPath) {
      return
    }

    let isDisposed = false
    const unsubscribeWorkspaceChanges = window.echosphereWorkspace.onExplorerChange((event) => {
      if (isDisposed || event.workspaceRootPath !== workspaceRootPath) {
        return
      }
      reloadExplorerTreeRef.current()
    })

    void window.echosphereWorkspace.watchExplorerChanges({
      workspaceRootPath,
    }).catch((error) => {
      console.error('Failed to watch workspace explorer changes', error)
    })

    void loadDirectory(ROOT_DIRECTORY_KEY)

    return () => {
      isDisposed = true
      unsubscribeWorkspaceChanges()
      void window.echosphereWorkspace.unwatchExplorerChanges({
        workspaceRootPath,
      }).catch((error) => {
        console.error('Failed to unwatch workspace explorer changes', error)
      })
    }
  }, [isOpen, loadDirectory, workspaceRootPath])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    if (!workspaceRootPath || !activeFilePath) {
      if (!activeFilePath) {
        lastSyncedActiveFileRef.current = {
          workspacePath: null,
          filePath: null,
        }
      }
      return
    }

    if (
      !shouldSyncActiveFileAncestors({
        activeFilePath,
        activeWorkspacePath: workspaceRootPath,
        lastSyncedFilePath: lastSyncedActiveFileRef.current.filePath,
        lastSyncedWorkspacePath: lastSyncedActiveFileRef.current.workspacePath,
      })
    ) {
      return
    }

    lastSyncedActiveFileRef.current = {
      workspacePath: workspaceRootPath,
      filePath: activeFilePath,
    }

    const ancestorDirectoryPaths = getAncestorDirectoryPaths(activeFilePath)
    if (ancestorDirectoryPaths.length === 0) {
      return
    }

    setExpandedDirectories((current) => {
      let hasChanges = false
      const nextState = new Set(current)
      for (const directoryPath of ancestorDirectoryPaths) {
        if (nextState.has(directoryPath)) {
          continue
        }
        nextState.add(directoryPath)
        hasChanges = true
      }

      return hasChanges ? nextState : current
    })

    const missingDirectoryPaths = ancestorDirectoryPaths.filter((directoryPath) => !directoryEntriesByPath[directoryPath])
    if (missingDirectoryPaths.length > 0) {
      void Promise.all(missingDirectoryPaths.map((directoryPath) => loadDirectory(directoryPath)))
    }
  }, [activeFilePath, isOpen, loadDirectory, workspaceRootPath])

  useEffect(() => {
    if (!isOpen || !activeFilePath) {
      return
    }

    const animationFrameId = window.requestAnimationFrame(() => {
      const containerElement = treeContainerRef.current
      if (!containerElement) {
        return
      }

      const entryButtons = Array.from(containerElement.querySelectorAll<HTMLButtonElement>('[data-workspace-entry-path]'))
      const activeEntryButton = entryButtons.find(
        (entryButton) => entryButton.dataset.workspaceEntryPath === activeFilePath,
      )
      activeEntryButton?.scrollIntoView({
        block: 'nearest',
      })
    })

    return () => {
      window.cancelAnimationFrame(animationFrameId)
    }
  }, [activeFilePath, directoryEntriesByPath, expandedDirectories, isOpen])

  const submitPasteEntry = useCallback(
    async (targetDirectoryRelativePath: string) => {
      closeContextMenu()
      try {
        await onPasteEntry(targetDirectoryRelativePath)
        setErrorMessage(null)
        const loadOperations = [loadDirectory(ROOT_DIRECTORY_KEY), loadDirectory(targetDirectoryRelativePath)]
        if (clipboardEntry?.mode === 'cut') {
          const sourceParentPaths = Array.from(
            new Set(clipboardEntry.relativePaths.map((relativePath) => getPathDirname(relativePath))),
          )
          for (const sourceParentPath of sourceParentPaths) {
            loadOperations.push(loadDirectory(sourceParentPath))
          }
        }
        await Promise.all(loadOperations)
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Failed to paste workspace entry.')
      }
    },
    [clipboardEntry, closeContextMenu, loadDirectory, onPasteEntry],
  )

  const submitMoveEntry = useCallback(
    async (relativePath: string, targetDirectoryRelativePath: string) => {
      setDropTargetDirectoryPath(null)
      try {
        await onMoveEntry(relativePath, targetDirectoryRelativePath)
        const basename = getPathBasename(relativePath)
        const resultRelativePath = targetDirectoryRelativePath === ROOT_DIRECTORY_KEY || targetDirectoryRelativePath === '.'
          ? basename
          : `${targetDirectoryRelativePath}/${basename}`
        undoStack.recordMove(relativePath, resultRelativePath)
        setErrorMessage(null)
        const sourceParentPath = getPathDirname(relativePath)
        await Promise.all([
          loadDirectory(ROOT_DIRECTORY_KEY),
          loadDirectory(sourceParentPath),
          loadDirectory(targetDirectoryRelativePath),
        ])
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Failed to move workspace entry.')
      }
    },
    [loadDirectory, onMoveEntry, undoStack],
  )

  const submitImportEntries = useCallback(
    async (sourcePaths: readonly string[], targetDirectoryRelativePath: string) => {
      if (!workspaceRootPath) {
        throw new Error('Select a workspace folder first.')
      }

      const uniqueSourcePaths = Array.from(
        new Set(sourcePaths.map((sourcePath) => sourcePath.trim()).filter((sourcePath) => sourcePath.length > 0)),
      )
      if (uniqueSourcePaths.length === 0) {
        return
      }

      setDropTargetDirectoryPath(null)
      try {
        for (const sourcePath of uniqueSourcePaths) {
          await onImportEntry(sourcePath, targetDirectoryRelativePath)
        }
        setErrorMessage(null)
        await Promise.all([loadDirectory(ROOT_DIRECTORY_KEY), loadDirectory(targetDirectoryRelativePath)])
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Failed to import workspace entry.')
      }
    },
    [loadDirectory, onImportEntry, workspaceRootPath],
  )

  const handleExplorerPaste = useCallback(
    async (event: ReactClipboardEvent<HTMLElement>) => {
      if (!isTreeShortcutTarget(event.target)) {
        return
      }

      const filePaths = await getExternalClipboardFilePaths(event)
      if (filePaths.length > 0) {
        event.preventDefault()
        event.stopPropagation()
        await submitImportEntries(filePaths, selectionDirectoryPath)
        return
      }

      if (!clipboardEntry) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      await submitPasteEntry(selectionDirectoryPath)
    },
    [clipboardEntry, selectionDirectoryPath, submitImportEntries, submitPasteEntry],
  )

  const handleEntryDragStart = useCallback((event: ReactDragEvent<HTMLButtonElement>, entry: WorkspaceExplorerEntry) => {
    draggedEntryRef.current = entry
    setIsDraggingExplorerEntry(true)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', entry.relativePath)
  }, [])

  const handleEntryDragEnd = useCallback(() => {
    draggedEntryRef.current = null
    setIsDraggingExplorerEntry(false)
    setDropTargetDirectoryPath(null)
    stopDragScroll()
  }, [stopDragScroll])

  const handleDirectoryDragOver = useCallback(
    (event: ReactDragEvent<HTMLElement>, targetDirectoryRelativePath: string) => {
      if (!draggedEntryRef.current) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      updateDragScroll(event)
      event.dataTransfer.dropEffect = 'move'
      if (dropTargetDirectoryPath !== targetDirectoryRelativePath) {
        setDropTargetDirectoryPath(targetDirectoryRelativePath)
      }
    },
    [dropTargetDirectoryPath, updateDragScroll],
  )

  const handleDirectoryDrop = useCallback(
    (event: ReactDragEvent<HTMLElement>, targetDirectoryRelativePath: string) => {
      const draggedEntry = draggedEntryRef.current
      if (!draggedEntry) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      stopDragScroll()
      draggedEntryRef.current = null
      setIsDraggingExplorerEntry(false)
      void submitMoveEntry(draggedEntry.relativePath, targetDirectoryRelativePath)
    },
    [stopDragScroll, submitMoveEntry],
  )

  const handleDirectoryDragLeave = useCallback(
    (event: ReactDragEvent<HTMLElement>, targetDirectoryRelativePath: string) => {
      if (dropTargetDirectoryPath !== targetDirectoryRelativePath) {
        return
      }
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
        return
      }
      setDropTargetDirectoryPath(null)
    },
    [dropTargetDirectoryPath],
  )

  const handleExternalDragOver = useCallback(
    (event: ReactDragEvent<HTMLElement>, targetDirectoryRelativePath: string) => {
      if (!workspaceRootPath) {
        return
      }

      const hasFiles = Array.from(event.dataTransfer.types).includes('Files')
      if (!hasFiles) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      updateDragScroll(event)
      event.dataTransfer.dropEffect = 'copy'
      if (dropTargetDirectoryPath !== targetDirectoryRelativePath) {
        setDropTargetDirectoryPath(targetDirectoryRelativePath)
      }
    },
    [dropTargetDirectoryPath, updateDragScroll, workspaceRootPath],
  )

  const handleExternalDragLeave = useCallback(
    (event: ReactDragEvent<HTMLElement>, targetDirectoryRelativePath: string) => {
      if (dropTargetDirectoryPath !== targetDirectoryRelativePath) {
        return
      }

      if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
        return
      }

      setDropTargetDirectoryPath(null)
    },
    [dropTargetDirectoryPath],
  )

  const handleExternalDrop = useCallback(
    async (event: ReactDragEvent<HTMLElement>, targetDirectoryRelativePath: string) => {
      if (!workspaceRootPath) {
        return
      }

      const filePaths = getExternalFilePaths(event)

      if (filePaths.length === 0) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      stopDragScroll()
      setDropTargetDirectoryPath(null)

      try {
        await submitImportEntries(filePaths, targetDirectoryRelativePath)
      } finally {
        setDropTargetDirectoryPath(null)
      }
    },
    [stopDragScroll, submitImportEntries, workspaceRootPath],
  )

  const requestRenameEntry = useCallback(() => {
    const targetEntry = contextMenuState?.targetEntry
    if (!targetEntry) {
      closeContextMenu()
      return
    }

    closeContextMenu()
    resetCreation()
    isSubmittingCreationRef.current = false
    isExplorerEditingRef.current = true
    setErrorMessage(null)
    setRenameDraft({ entry: targetEntry })
    setRenameName(getPathBasename(targetEntry.relativePath))
    setSelectedEntryPaths(new Set([targetEntry.relativePath]))
    setSelectionDirectoryPath(getSelectionDirectoryPath(targetEntry))
    selectionAnchorEntryPathRef.current = targetEntry.relativePath
  }, [closeContextMenu, contextMenuState, isSubmittingCreationRef, resetCreation])

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

  const selectEntry = useCallback((entry: WorkspaceExplorerEntry) => {
    setSelectionDirectoryPath(getSelectionDirectoryPath(entry))
    setSelectedEntryPaths(new Set([entry.relativePath]))
    selectionAnchorEntryPathRef.current = entry.relativePath
  }, [])

  const clearEntrySelection = useCallback(() => {
    setSelectionDirectoryPath(ROOT_DIRECTORY_KEY)
    setSelectedEntryPaths(new Set())
    selectionAnchorEntryPathRef.current = null
  }, [])

  const toggleEntrySelection = useCallback((entry: WorkspaceExplorerEntry) => {
    const nextSelectionDirectoryPath = getSelectionDirectoryPath(entry)
    setSelectionDirectoryPath(nextSelectionDirectoryPath)
    selectionAnchorEntryPathRef.current = entry.relativePath
    setSelectedEntryPaths((currentPaths) => {
      if (selectionDirectoryPath !== nextSelectionDirectoryPath) {
        return new Set([entry.relativePath])
      }

      const nextPaths = new Set(currentPaths)
      if (nextPaths.has(entry.relativePath)) {
        nextPaths.delete(entry.relativePath)
      } else {
        nextPaths.add(entry.relativePath)
      }
      return nextPaths
    })
  }, [selectionDirectoryPath])

  const selectEntryRange = useCallback((entry: WorkspaceExplorerEntry) => {
    const nextSelectionDirectoryPath = getSelectionDirectoryPath(entry)
    const directoryEntries = getDirectoryEntriesForSelection(
      directoryEntriesByPath,
      rootEntries,
      nextSelectionDirectoryPath,
    )
    const anchorEntryPath = selectionDirectoryPath === nextSelectionDirectoryPath
      ? selectionAnchorEntryPathRef.current
      : null
    const anchorIndex = anchorEntryPath
      ? directoryEntries.findIndex((candidateEntry) => candidateEntry.relativePath === anchorEntryPath)
      : -1
    const targetIndex = directoryEntries.findIndex((candidateEntry) => candidateEntry.relativePath === entry.relativePath)

    if (anchorIndex === -1 || targetIndex === -1) {
      selectEntry(entry)
      return
    }

    const startIndex = Math.min(anchorIndex, targetIndex)
    const endIndex = Math.max(anchorIndex, targetIndex)
    setSelectionDirectoryPath(nextSelectionDirectoryPath)
    setSelectedEntryPaths(new Set(directoryEntries.slice(startIndex, endIndex + 1).map((candidateEntry) => candidateEntry.relativePath)))
  }, [directoryEntriesByPath, rootEntries, selectEntry, selectionDirectoryPath])

  const selectAllLoadedEntriesInSelectionDirectory = useCallback(() => {
    const anchorEntryPath = selectionAnchorEntryPathRef.current
    const selectedDirectoryEntry =
      selectedEntryPaths.size === 1 && anchorEntryPath && selectedEntryPaths.has(anchorEntryPath)
        ? findLoadedExplorerEntry(rootEntries, directoryEntriesByPath, anchorEntryPath)
        : null
    const selectionDirectoryEntries = getDirectoryEntriesForSelection(
      directoryEntriesByPath,
      rootEntries,
      selectionDirectoryPath,
    )
    const loadedEntryPaths =
      selectedDirectoryEntry?.isDirectory === true
        ? collectLoadedExplorerEntryPaths([selectedDirectoryEntry], directoryEntriesByPath)
        : collectLoadedExplorerEntryPaths(selectionDirectoryEntries, directoryEntriesByPath)
    if (loadedEntryPaths.length === 0) {
      return false
    }

    setSelectedEntryPaths(new Set(loadedEntryPaths))
    selectionAnchorEntryPathRef.current = loadedEntryPaths[0] ?? null
    return true
  }, [directoryEntriesByPath, rootEntries, selectedEntryPaths, selectionDirectoryPath])

  const handleTreeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!isTreeShortcutTarget(event.target)) {
        return
      }

      if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.key === 'Delete') {
        if (selectedEntryPaths.size === 0) {
          return
        }
        event.preventDefault()
        openDeleteDialog(Array.from(selectedEntryPaths), findLoadedExplorerEntry(rootEntries, directoryEntriesByPath, Array.from(selectedEntryPaths)[0]) ?? null)
        return
      }

      if (!event.ctrlKey && !event.metaKey) {
        return
      }

      const key = event.key.toLowerCase()
      if (event.shiftKey || event.altKey) {
        return
      }

      if (key === 'z') {
        event.preventDefault()
        void (async () => {
          const didUndo = await undoStack.undo()
          if (!didUndo && undoStack.canUndo()) {
            setErrorMessage('Failed to undo the last operation.')
          }
        })()
        return
      }

      if (key === 'a') {
        event.preventDefault()
        selectAllLoadedEntriesInSelectionDirectory()
        return
      }

      const selectedRelativePaths =
        selectedEntryPaths.size > 0
          ? Array.from(selectedEntryPaths)
          : activeFilePath
            ? [activeFilePath]
            : []

      if (key === 'c') {
        event.preventDefault()
        requestCopyOrCutEntries(selectedRelativePaths, 'copy')
        return
      }

      if (key === 'x') {
        event.preventDefault()
        requestCopyOrCutEntries(selectedRelativePaths, 'cut')
        return
      }

      if (key === 'v') {
        event.preventDefault()
        void (async () => {
          // Determine the paste target: if a single folder is selected, paste into it.
          // Otherwise paste into the current selection directory.
          let pasteTargetPath = selectionDirectoryPath
          if (selectedEntryPaths.size === 1) {
            const selectedPath = Array.from(selectedEntryPaths)[0]
            const selectedEntry = findLoadedExplorerEntry(rootEntries, directoryEntriesByPath, selectedPath)
            if (selectedEntry?.isDirectory) {
              pasteTargetPath = toDirectoryKey(selectedEntry.relativePath)
            }
          }

          // Try reading files from the OS clipboard (e.g. files copied in Windows Explorer)
          if (typeof window !== 'undefined' && window.echosphereClipboard) {
            try {
              const osPaths = await window.echosphereClipboard.readFiles()
              if (osPaths.length > 0) {
                await submitImportEntries(osPaths, pasteTargetPath)
                return
              }
            } catch (e) {
              console.error('Failed to read OS clipboard files', e)
            }
          }

          // Fall back to internal clipboard paste
          if (clipboardEntry) {
            await submitPasteEntry(pasteTargetPath)
          }
        })()
        return
      }

    },
    [
      activeFilePath,
      clipboardEntry,
      directoryEntriesByPath,
      openDeleteDialog,
      requestCopyOrCutEntries,
      rootEntries,
      selectAllLoadedEntriesInSelectionDirectory,
      selectedEntryPaths,
      selectionDirectoryPath,
      submitImportEntries,
      submitPasteEntry,
      undoStack,
    ],
  )

  const toggleDirectory = useCallback(
    (directory: WorkspaceExplorerEntry) => {
      const directoryPath = toDirectoryKey(directory.relativePath)
      setExpandedDirectories((current) => {
        const nextState = new Set(current)
        if (nextState.has(directoryPath)) {
          nextState.delete(directoryPath)
        } else {
          nextState.add(directoryPath)
        }
        return nextState
      })

      if (!directoryEntriesByPath[directoryPath]) {
        void loadDirectory(directoryPath)
      }
    },
    [directoryEntriesByPath, loadDirectory],
  )

  const handleEntryClick = useCallback(
    (entry: WorkspaceExplorerEntry, event: ReactMouseEvent<HTMLButtonElement>) => {
      if (event.shiftKey) {
        selectEntryRange(entry)
        return
      }

      if (event.ctrlKey || event.metaKey) {
        toggleEntrySelection(entry)
        return
      }

      selectEntry(entry)
      if (entry.isDirectory) {
        toggleDirectory(entry)
        return
      }

      onOpenFile(entry.relativePath)
    },
    [onOpenFile, selectEntry, selectEntryRange, toggleDirectory, toggleEntrySelection],
  )

  const handleExplorerBackgroundClick = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (event.button !== 0 || event.target !== event.currentTarget) {
      return
    }

    clearEntrySelection()
  }, [clearEntrySelection])

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
    onRenameNameChange: setRenameName,
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
