import {
  useCallback,
  type ClipboardEvent as ReactClipboardEvent,
  type Dispatch,
  type DragEvent as ReactDragEvent,
  type MutableRefObject,
  type SetStateAction,
} from 'react'
import { toUserFacingErrorMessage } from '../../../lib/userFacingError'
import { getPathBasename, getPathDirname } from '../../../lib/pathPresentation'
import type { WorkspaceExplorerEntry } from '../../../types/chat'
import type { WorkspaceClipboardEntry } from '../workspaceClipboardTypes'
import { getExternalClipboardFilePaths, getExternalFilePaths } from './workspaceExplorerDragUtils'
import { ROOT_DIRECTORY_KEY } from './workspaceExplorerPanelUtils'
import { findLoadedExplorerEntry, isTreeShortcutTarget } from './workspaceExplorerSelectionUtils'

interface UseWorkspaceExplorerTransfersOptions {
  clipboardEntry: WorkspaceClipboardEntry | null
  closeContextMenu: () => void
  directoryEntriesByPath: Record<string, WorkspaceExplorerEntry[]>
  draggedEntriesRef: MutableRefObject<WorkspaceExplorerEntry[]>
  dropTargetDirectoryPath: string | null
  loadDirectory: (relativePath?: string, options?: { hideError?: boolean }) => Promise<void>
  onImportEntry: (sourcePath: string, targetDirectoryRelativePath: string) => Promise<void>
  onMoveEntry: (relativePath: string, targetDirectoryRelativePath: string) => Promise<void>
  onPasteEntry: (targetDirectoryRelativePath: string) => Promise<void>
  recordMove: (sourceRelativePath: string, resultRelativePath: string) => void
  reloadExplorerTree: (options?: { force?: boolean }) => Promise<void>
  rootEntries: WorkspaceExplorerEntry[]
  selectedEntryPaths: Set<string>
  selectionDirectoryPath: string
  setDropTargetDirectoryPath: Dispatch<SetStateAction<string | null>>
  setErrorMessage: Dispatch<SetStateAction<string | null>>
  setIsDraggingExplorerEntry: Dispatch<SetStateAction<boolean>>
  setSelectedEntryPaths: Dispatch<SetStateAction<Set<string>>>
  stopDragScroll: () => void
  updateDragScroll: (event: ReactDragEvent<HTMLElement>) => void
  workspaceRootPath: string | null
}

export function useWorkspaceExplorerTransfers({
  clipboardEntry,
  closeContextMenu,
  directoryEntriesByPath,
  draggedEntriesRef,
  dropTargetDirectoryPath,
  loadDirectory,
  onImportEntry,
  onMoveEntry,
  onPasteEntry,
  recordMove,
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
}: UseWorkspaceExplorerTransfersOptions) {
  const submitPasteEntry = useCallback(
    async (targetDirectoryRelativePath: string) => {
      closeContextMenu()
      try {
        await onPasteEntry(targetDirectoryRelativePath)
        setErrorMessage(null)
        const loadOperations = [reloadExplorerTree({ force: true })]
        if (targetDirectoryRelativePath !== ROOT_DIRECTORY_KEY) {
          loadOperations.push(loadDirectory(targetDirectoryRelativePath))
        }
        await Promise.all(loadOperations)
      } catch (error) {
        setErrorMessage(toUserFacingErrorMessage(error, 'The workspace item could not be pasted.'))
      }
    },
    [closeContextMenu, loadDirectory, onPasteEntry, reloadExplorerTree, setErrorMessage],
  )

  const submitMoveEntries = useCallback(
    async (relativePaths: readonly string[], targetDirectoryRelativePath: string) => {
      setDropTargetDirectoryPath(null)

      const validPaths = relativePaths.filter((relativePath) => {
        if (relativePath === targetDirectoryRelativePath) {
          return false
        }
        return !(
          targetDirectoryRelativePath !== ROOT_DIRECTORY_KEY &&
          targetDirectoryRelativePath.startsWith(`${relativePath}/`)
        )
      })

      if (validPaths.length === 0) {
        return
      }

      try {
        const sourceParentPaths = new Set<string>()
        for (const relativePath of validPaths) {
          await onMoveEntry(relativePath, targetDirectoryRelativePath)
          const basename = getPathBasename(relativePath)
          const resultRelativePath =
            targetDirectoryRelativePath === ROOT_DIRECTORY_KEY || targetDirectoryRelativePath === '.'
              ? basename
              : `${targetDirectoryRelativePath}/${basename}`
          recordMove(relativePath, resultRelativePath)
          const sourceParentPath = getPathDirname(relativePath)
          if (sourceParentPath !== ROOT_DIRECTORY_KEY) {
            sourceParentPaths.add(sourceParentPath)
          }
        }
        setErrorMessage(null)
        setSelectedEntryPaths(new Set())

        const loadOperations = [reloadExplorerTree({ force: true })]
        if (targetDirectoryRelativePath !== ROOT_DIRECTORY_KEY) {
          loadOperations.push(loadDirectory(targetDirectoryRelativePath))
        }
        for (const sourceParentPath of sourceParentPaths) {
          loadOperations.push(loadDirectory(sourceParentPath))
        }
        await Promise.all(loadOperations)
      } catch (error) {
        setErrorMessage(toUserFacingErrorMessage(error, 'The workspace item could not be moved.'))
      }
    },
    [
      loadDirectory,
      onMoveEntry,
      recordMove,
      reloadExplorerTree,
      setDropTargetDirectoryPath,
      setErrorMessage,
      setSelectedEntryPaths,
    ],
  )

  const submitMoveEntry = useCallback(
    async (relativePath: string, targetDirectoryRelativePath: string) => {
      await submitMoveEntries([relativePath], targetDirectoryRelativePath)
    },
    [submitMoveEntries],
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
        setSelectedEntryPaths(new Set())
        const loadOperations = [reloadExplorerTree({ force: true })]
        if (targetDirectoryRelativePath !== ROOT_DIRECTORY_KEY) {
          loadOperations.push(loadDirectory(targetDirectoryRelativePath))
        }
        await Promise.all(loadOperations)
      } catch (error) {
        setErrorMessage(toUserFacingErrorMessage(error, 'The workspace item could not be imported.'))
      }
    },
    [
      loadDirectory,
      onImportEntry,
      reloadExplorerTree,
      setDropTargetDirectoryPath,
      setErrorMessage,
      setSelectedEntryPaths,
      workspaceRootPath,
    ],
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

  const handleEntryDragStart = useCallback(
    (event: ReactDragEvent<HTMLButtonElement>, entry: WorkspaceExplorerEntry) => {
      const selectedPaths = selectedEntryPaths.has(entry.relativePath)
        ? Array.from(selectedEntryPaths)
        : [entry.relativePath]
      const draggedEntries = selectedPaths.flatMap((relativePath) => {
        const loadedEntry = findLoadedExplorerEntry(rootEntries, directoryEntriesByPath, relativePath)
        return loadedEntry ? [loadedEntry] : []
      })
      const entriesToDrag = draggedEntries.length > 0 ? draggedEntries : [entry]

      draggedEntriesRef.current = entriesToDrag
      setIsDraggingExplorerEntry(true)
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', entriesToDrag.map((draggedEntry) => draggedEntry.relativePath).join('\n'))
    },
    [directoryEntriesByPath, draggedEntriesRef, rootEntries, selectedEntryPaths, setIsDraggingExplorerEntry],
  )

  const handleEntryDragEnd = useCallback(() => {
    draggedEntriesRef.current = []
    setIsDraggingExplorerEntry(false)
    setDropTargetDirectoryPath(null)
    stopDragScroll()
  }, [draggedEntriesRef, setDropTargetDirectoryPath, setIsDraggingExplorerEntry, stopDragScroll])

  const handleDirectoryDragOver = useCallback(
    (event: ReactDragEvent<HTMLElement>, targetDirectoryRelativePath: string) => {
      if (draggedEntriesRef.current.length === 0) {
        return
      }
      const hasValidMove = draggedEntriesRef.current.some((draggedEntry) => {
        if (draggedEntry.relativePath === targetDirectoryRelativePath) {
          return false
        }
        return !(
          draggedEntry.isDirectory &&
          targetDirectoryRelativePath !== ROOT_DIRECTORY_KEY &&
          targetDirectoryRelativePath.startsWith(`${draggedEntry.relativePath}/`)
        )
      })
      if (!hasValidMove) {
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
    [draggedEntriesRef, dropTargetDirectoryPath, setDropTargetDirectoryPath, updateDragScroll],
  )

  const handleDirectoryDrop = useCallback(
    (event: ReactDragEvent<HTMLElement>, targetDirectoryRelativePath: string) => {
      const draggedEntries = draggedEntriesRef.current
      if (draggedEntries.length === 0) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      stopDragScroll()
      draggedEntriesRef.current = []
      setIsDraggingExplorerEntry(false)
      void submitMoveEntries(
        draggedEntries.map((draggedEntry) => draggedEntry.relativePath),
        targetDirectoryRelativePath,
      )
    },
    [draggedEntriesRef, setIsDraggingExplorerEntry, stopDragScroll, submitMoveEntries],
  )

  const handleDirectoryDragLeave = useCallback(
    (event: ReactDragEvent<HTMLElement>, targetDirectoryRelativePath: string) => {
      if (
        dropTargetDirectoryPath === targetDirectoryRelativePath &&
        !event.currentTarget.contains(event.relatedTarget as Node | null)
      ) {
        setDropTargetDirectoryPath(null)
      }
    },
    [dropTargetDirectoryPath, setDropTargetDirectoryPath],
  )

  const handleExternalDragOver = useCallback(
    (event: ReactDragEvent<HTMLElement>, targetDirectoryRelativePath: string) => {
      if (!workspaceRootPath || !Array.from(event.dataTransfer.types).includes('Files')) {
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
    [dropTargetDirectoryPath, setDropTargetDirectoryPath, updateDragScroll, workspaceRootPath],
  )

  const handleExternalDragLeave = useCallback(
    (event: ReactDragEvent<HTMLElement>, targetDirectoryRelativePath: string) => {
      if (dropTargetDirectoryPath !== targetDirectoryRelativePath) {
        return
      }
      if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget as Node)) {
        return
      }

      const rect = event.currentTarget.getBoundingClientRect()
      const { clientX, clientY } = event
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        return
      }
      setDropTargetDirectoryPath(null)
    },
    [dropTargetDirectoryPath, setDropTargetDirectoryPath],
  )

  const handleExternalDrop = useCallback(
    async (event: ReactDragEvent<HTMLElement>, targetDirectoryRelativePath: string) => {
      event.preventDefault()
      event.stopPropagation()
      stopDragScroll()
      setDropTargetDirectoryPath(null)

      if (!workspaceRootPath) {
        return
      }

      let filePaths: string[] = []
      try {
        filePaths = getExternalFilePaths(event)
      } catch (error) {
        console.error('Failed to get external file paths:', error)
      }
      if (filePaths.length === 0) {
        return
      }

      try {
        await submitImportEntries(filePaths, targetDirectoryRelativePath)
      } catch (error) {
        setErrorMessage(toUserFacingErrorMessage(error, 'The workspace item could not be imported.'))
      }
    },
    [setDropTargetDirectoryPath, setErrorMessage, stopDragScroll, submitImportEntries, workspaceRootPath],
  )

  return {
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
  }
}
