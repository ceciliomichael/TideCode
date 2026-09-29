import {
  useCallback,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
  type SetStateAction,
} from 'react'
import type { WorkspaceExplorerEntry } from '../../../types/chat'
import { ROOT_DIRECTORY_KEY, toDirectoryKey } from './workspaceExplorerPanelUtils'
import {
  collectVisibleExplorerEntries,
  collectLoadedExplorerEntryPaths,
  findLoadedExplorerEntry,
  getFirstVisibleExplorerChild,
  getDirectoryEntriesForSelection,
  getSelectionDirectoryPath,
  getVisibleExplorerParentPath,
  isTreeShortcutTarget,
  resolvePasteTargetDirectoryPath,
} from './workspaceExplorerSelectionUtils'

interface ExplorerUndoActions {
  canUndo: () => boolean
  undo: () => Promise<boolean>
}

interface UseWorkspaceExplorerSelectionOptions {
  activeFilePath: string | null
  directoryEntriesByPath: Record<string, WorkspaceExplorerEntry[]>
  expandedDirectories: Set<string>
  loadDirectory: (relativePath?: string, options?: { hideError?: boolean }) => Promise<void>
  onOpenFile: (relativePath: string) => void
  requestRenameEntry: (entry: WorkspaceExplorerEntry) => void
  requestDeleteEntries: (targetRelativePaths: readonly string[]) => Promise<void>
  requestCopyOrCutEntries: (relativePaths: readonly string[], mode: 'copy' | 'cut') => void
  startCreateEntry: (isDirectory: boolean, parentPath: string) => void
  rootEntries: WorkspaceExplorerEntry[]
  selectedEntryPaths: Set<string>
  selectionAnchorEntryPathRef: MutableRefObject<string | null>
  selectionDirectoryPath: string
  setErrorMessage: Dispatch<SetStateAction<string | null>>
  setExpandedDirectories: Dispatch<SetStateAction<Set<string>>>
  setSelectedEntryPaths: Dispatch<SetStateAction<Set<string>>>
  setSelectionDirectoryPath: Dispatch<SetStateAction<string>>
  submitClipboardContents: (targetDirectoryRelativePath: string) => Promise<void>
  undoStack: ExplorerUndoActions
}

export function useWorkspaceExplorerSelection({
  activeFilePath,
  directoryEntriesByPath,
  expandedDirectories,
  loadDirectory,
  onOpenFile,
  requestRenameEntry,
  requestDeleteEntries,
  requestCopyOrCutEntries,
  startCreateEntry,
  rootEntries,
  selectedEntryPaths,
  selectionAnchorEntryPathRef,
  selectionDirectoryPath,
  setErrorMessage,
  setExpandedDirectories,
  setSelectedEntryPaths,
  setSelectionDirectoryPath,
  submitClipboardContents,
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

  const focusSelectedEntry = useCallback((relativePath: string) => {
    window.requestAnimationFrame(() => {
      const entryButton = Array.from(
        document.querySelectorAll<HTMLButtonElement>('[data-workspace-entry-path]'),
      ).find((button) => button.dataset.workspaceEntryPath === relativePath)
      entryButton?.focus({ preventScroll: true })
      entryButton?.scrollIntoView({ block: 'nearest' })
    })
  }, [])

  const selectKeyboardEntry = useCallback((entry: WorkspaceExplorerEntry) => {
    selectEntry(entry)
    focusSelectedEntry(entry.relativePath)
  }, [focusSelectedEntry, selectEntry])

  const handleTreeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!isTreeShortcutTarget(event.target)) {
        return
      }

      const hasModifier = event.ctrlKey || event.metaKey || event.shiftKey || event.altKey
      const selectedPath = selectedEntryPaths.size === 1 ? Array.from(selectedEntryPaths)[0] : null
      const selectedEntry = selectedPath
        ? findLoadedExplorerEntry(rootEntries, directoryEntriesByPath, selectedPath)
        : null

      if (!hasModifier && event.key === 'F2') {
        if (!selectedEntry) {
          return
        }
        event.preventDefault()
        requestRenameEntry(selectedEntry)
        return
      }

      if (!hasModifier && event.key === 'Escape') {
        if (selectedEntryPaths.size === 0) {
          return
        }
        event.preventDefault()
        clearEntrySelection()
        return
      }

      if (!hasModifier && event.key === 'Enter') {
        if (!selectedEntry) {
          return
        }
        event.preventDefault()
        if (selectedEntry.isDirectory) {
          toggleDirectory(selectedEntry)
        } else {
          onOpenFile(selectedEntry.relativePath)
        }
        return
      }

      if (!hasModifier && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        const visibleEntries = collectVisibleExplorerEntries(
          rootEntries,
          directoryEntriesByPath,
          expandedDirectories,
        )
        if (visibleEntries.length === 0) {
          return
        }
        const currentIndex = selectedPath
          ? visibleEntries.findIndex((entry) => entry.relativePath === selectedPath)
          : -1
        const nextIndex = event.key === 'ArrowDown'
          ? Math.min(visibleEntries.length - 1, currentIndex < 0 ? 0 : currentIndex + 1)
          : Math.max(0, currentIndex < 0 ? visibleEntries.length - 1 : currentIndex - 1)
        const nextEntry = visibleEntries[nextIndex]
        if (!nextEntry) {
          return
        }
        event.preventDefault()
        selectKeyboardEntry(nextEntry)
        return
      }

      if (!hasModifier && event.key === 'ArrowRight') {
        if (!selectedEntry?.isDirectory) {
          return
        }
        event.preventDefault()
        const directoryPath = toDirectoryKey(selectedEntry.relativePath)
        if (!expandedDirectories.has(directoryPath)) {
          toggleDirectory(selectedEntry)
          return
        }
        const firstChild = getFirstVisibleExplorerChild(selectedEntry, directoryEntriesByPath)
        if (firstChild) {
          selectKeyboardEntry(firstChild)
        }
        return
      }

      if (!hasModifier && event.key === 'ArrowLeft') {
        if (!selectedEntry) {
          return
        }
        event.preventDefault()
        const directoryPath = toDirectoryKey(selectedEntry.relativePath)
        if (selectedEntry.isDirectory && expandedDirectories.has(directoryPath)) {
          toggleDirectory(selectedEntry)
          return
        }
        const parentPath = getVisibleExplorerParentPath(selectedEntry.relativePath)
        const parentEntry = parentPath
          ? findLoadedExplorerEntry(rootEntries, directoryEntriesByPath, parentPath)
          : null
        if (parentEntry) {
          selectKeyboardEntry(parentEntry)
        }
        return
      }

      if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.key === 'Delete') {
        if (selectedEntryPaths.size === 0) {
          return
        }
        event.preventDefault()
        void requestDeleteEntries(Array.from(selectedEntryPaths))
        return
      }

      if (!event.ctrlKey && !event.metaKey) {
        return
      }

      const key = event.key.toLowerCase()
      if (event.altKey) {
        return
      }

      if (key === 'n') {
        event.preventDefault()
        const targetDirectoryPath = resolvePasteTargetDirectoryPath({
          directoryEntriesByPath,
          rootEntries,
          selectedEntryPaths,
          selectionDirectoryPath,
        })
        startCreateEntry(event.shiftKey, targetDirectoryPath)
        return
      }

      if (event.shiftKey) {
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
        const pasteTargetPath = resolvePasteTargetDirectoryPath({
          directoryEntriesByPath,
          rootEntries,
          selectedEntryPaths,
          selectionDirectoryPath,
        })

        await submitClipboardContents(pasteTargetPath)
      })()
    },
    [
      activeFilePath,
      clearEntrySelection,
      directoryEntriesByPath,
      expandedDirectories,
      focusSelectedEntry,
      onOpenFile,
      requestDeleteEntries,
      requestCopyOrCutEntries,
      requestRenameEntry,
      rootEntries,
      selectAllLoadedEntriesInSelectionDirectory,
      selectKeyboardEntry,
      selectedEntryPaths,
      selectionDirectoryPath,
      startCreateEntry,
      setErrorMessage,
      submitClipboardContents,
      toggleDirectory,
      undoStack,
    ],
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
