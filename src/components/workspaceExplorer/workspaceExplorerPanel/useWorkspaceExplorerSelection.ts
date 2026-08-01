import {
  useCallback,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
  type SetStateAction,
} from 'react'
import type { WorkspaceExplorerEntry } from '../../../types/chat'
import type { WorkspaceClipboardEntry } from '../workspaceClipboardTypes'
import { ROOT_DIRECTORY_KEY, toDirectoryKey } from './workspaceExplorerPanelUtils'
import {
  collectLoadedExplorerEntryPaths,
  findLoadedExplorerEntry,
  getDirectoryEntriesForSelection,
  getSelectionDirectoryPath,
  isTreeShortcutTarget,
} from './workspaceExplorerSelectionUtils'

interface ExplorerUndoActions {
  canUndo: () => boolean
  undo: () => Promise<boolean>
}

interface UseWorkspaceExplorerSelectionOptions {
  activeFilePath: string | null
  clipboardEntry: WorkspaceClipboardEntry | null
  directoryEntriesByPath: Record<string, WorkspaceExplorerEntry[]>
  expandedDirectories: Set<string>
  loadDirectory: (relativePath?: string, options?: { hideError?: boolean }) => Promise<void>
  onOpenFile: (relativePath: string) => void
  openDeleteDialog: (targetRelativePaths: readonly string[], targetEntry: WorkspaceExplorerEntry | null) => void
  requestCopyOrCutEntries: (relativePaths: readonly string[], mode: 'copy' | 'cut') => void
  rootEntries: WorkspaceExplorerEntry[]
  selectedEntryPaths: Set<string>
  selectionAnchorEntryPathRef: MutableRefObject<string | null>
  selectionDirectoryPath: string
  setErrorMessage: Dispatch<SetStateAction<string | null>>
  setExpandedDirectories: Dispatch<SetStateAction<Set<string>>>
  setSelectedEntryPaths: Dispatch<SetStateAction<Set<string>>>
  setSelectionDirectoryPath: Dispatch<SetStateAction<string>>
  submitImportEntries: (sourcePaths: readonly string[], targetDirectoryRelativePath: string) => Promise<void>
  submitPasteEntry: (targetDirectoryRelativePath: string) => Promise<void>
  undoStack: ExplorerUndoActions
}

export function useWorkspaceExplorerSelection({
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
}: UseWorkspaceExplorerSelectionOptions) {
  const selectEntry = useCallback((entry: WorkspaceExplorerEntry) => {
    setSelectionDirectoryPath(getSelectionDirectoryPath(entry))
    setSelectedEntryPaths(new Set([entry.relativePath]))
    selectionAnchorEntryPathRef.current = entry.relativePath
  }, [selectionAnchorEntryPathRef, setSelectedEntryPaths, setSelectionDirectoryPath])

  const clearEntrySelection = useCallback(() => {
    setSelectionDirectoryPath(ROOT_DIRECTORY_KEY)
    setSelectedEntryPaths(new Set())
    selectionAnchorEntryPathRef.current = null
  }, [selectionAnchorEntryPathRef, setSelectedEntryPaths, setSelectionDirectoryPath])

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
  }, [selectionAnchorEntryPathRef, selectionDirectoryPath, setSelectedEntryPaths, setSelectionDirectoryPath])

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
    setSelectedEntryPaths(
      new Set(directoryEntries.slice(startIndex, endIndex + 1).map((candidateEntry) => candidateEntry.relativePath)),
    )
  }, [
    directoryEntriesByPath,
    rootEntries,
    selectEntry,
    selectionAnchorEntryPathRef,
    selectionDirectoryPath,
    setSelectedEntryPaths,
    setSelectionDirectoryPath,
  ])

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
    const loadedEntryPaths = selectedDirectoryEntry?.isDirectory === true
      ? collectLoadedExplorerEntryPaths([selectedDirectoryEntry], directoryEntriesByPath)
      : collectLoadedExplorerEntryPaths(selectionDirectoryEntries, directoryEntriesByPath)
    if (loadedEntryPaths.length === 0) {
      return false
    }

    setSelectedEntryPaths(new Set(loadedEntryPaths))
    selectionAnchorEntryPathRef.current = loadedEntryPaths[0] ?? null
    return true
  }, [
    directoryEntriesByPath,
    rootEntries,
    selectedEntryPaths,
    selectionAnchorEntryPathRef,
    selectionDirectoryPath,
    setSelectedEntryPaths,
  ])

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
        const firstSelectedPath = Array.from(selectedEntryPaths)[0]
        openDeleteDialog(
          Array.from(selectedEntryPaths),
          findLoadedExplorerEntry(rootEntries, directoryEntriesByPath, firstSelectedPath) ?? null,
        )
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

      const selectedRelativePaths = selectedEntryPaths.size > 0
        ? Array.from(selectedEntryPaths)
        : activeFilePath
          ? [activeFilePath]
          : []

      if (key === 'c' || key === 'x') {
        event.preventDefault()
        requestCopyOrCutEntries(selectedRelativePaths, key === 'c' ? 'copy' : 'cut')
        return
      }

      if (key !== 'v') {
        return
      }

      event.preventDefault()
      void (async () => {
        let pasteTargetPath = selectionDirectoryPath
        if (selectedEntryPaths.size === 1) {
          const selectedPath = Array.from(selectedEntryPaths)[0]
          const selectedEntry = findLoadedExplorerEntry(rootEntries, directoryEntriesByPath, selectedPath)
          if (selectedEntry?.isDirectory) {
            pasteTargetPath = toDirectoryKey(selectedEntry.relativePath)
          }
        }

        if (typeof window !== 'undefined' && window.echosphereClipboard) {
          try {
            const osPaths = await window.echosphereClipboard.readFiles()
            if (osPaths.length > 0) {
              await submitImportEntries(osPaths, pasteTargetPath)
              return
            }
          } catch (error) {
            console.error('Failed to read OS clipboard files', error)
          }
        }

        if (clipboardEntry) {
          await submitPasteEntry(pasteTargetPath)
        }
      })()
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
      setErrorMessage,
      submitImportEntries,
      submitPasteEntry,
      undoStack,
    ],
  )

  const toggleDirectory = useCallback(
    (directory: WorkspaceExplorerEntry) => {
      const directoryPath = toDirectoryKey(directory.relativePath)
      const isExpanding = !expandedDirectories.has(directoryPath)

      setExpandedDirectories((current) => {
        const nextState = new Set(current)
        if (isExpanding) {
          nextState.add(directoryPath)
        } else {
          nextState.delete(directoryPath)
        }
        return nextState
      })

      if (isExpanding) {
        void loadDirectory(directoryPath)
      }
    },
    [expandedDirectories, loadDirectory, setExpandedDirectories],
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
    if (event.button === 0 && event.target === event.currentTarget) {
      clearEntrySelection()
    }
  }, [clearEntrySelection])

  return {
    handleEntryClick,
    handleExplorerBackgroundClick,
    handleTreeKeyDown,
    toggleDirectory,
  }
}
