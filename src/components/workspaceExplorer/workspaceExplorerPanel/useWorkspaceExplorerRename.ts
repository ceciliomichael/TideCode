import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react'
import { toUserFacingErrorMessage } from '../../../lib/userFacingError'
import { getPathBasename, getPathDirname } from '../../../lib/pathPresentation'
import type {
  PendingExplorerCreation,
  PendingExplorerRename,
  WorkspaceExplorerContextMenuState,
} from './workspaceExplorerPanelTypes'
import { joinRelativePath, normalizeEntryPath } from './workspaceExplorerPanelUtils'
import { getSelectionDirectoryPath } from './workspaceExplorerSelectionUtils'

interface RenameUndoActions {
  recordRename: (oldPath: string, newPath: string, isDirectory: boolean) => void
}

interface UseWorkspaceExplorerRenameOptions {
  closeContextMenu: () => void
  contextMenuState: WorkspaceExplorerContextMenuState | null
  creationDraft: PendingExplorerCreation | null
  isExplorerEditingRef: MutableRefObject<boolean>
  isSubmittingCreationRef: MutableRefObject<boolean>
  loadDirectory: (relativePath?: string, options?: { hideError?: boolean }) => Promise<void>
  onRenameEntry: (relativePath: string, nextRelativePath: string) => Promise<void>
  replayPendingExplorerReload: () => void
  resetCreation: () => void
  selectionAnchorEntryPathRef: MutableRefObject<string | null>
  setErrorMessage: Dispatch<SetStateAction<string | null>>
  setExpandedDirectories: Dispatch<SetStateAction<Set<string>>>
  setSelectedEntryPaths: Dispatch<SetStateAction<Set<string>>>
  setSelectionDirectoryPath: Dispatch<SetStateAction<string>>
  undoStack: RenameUndoActions
}

export function useWorkspaceExplorerRename({
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
}: UseWorkspaceExplorerRenameOptions) {
  const [renameDraft, setRenameDraft] = useState<PendingExplorerRename | null>(null)
  const [renameName, setRenameName] = useState('')
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const isSubmittingRenameRef = useRef(false)

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

  const resetRename = useCallback(() => {
    setRenameDraft(null)
    setRenameName('')
    isSubmittingRenameRef.current = false
  }, [])

  const prepareForCreation = useCallback(() => {
    resetRename()
    isExplorerEditingRef.current = true
  }, [isExplorerEditingRef, resetRename])

  const cancelRenameEntry = useCallback(() => {
    resetRename()
    isExplorerEditingRef.current = Boolean(creationDraft)
    if (!creationDraft) {
      replayPendingExplorerReload()
    }
  }, [creationDraft, isExplorerEditingRef, replayPendingExplorerReload, resetRename])

  const submitRenameEntry = useCallback(async () => {
    const draft = renameDraft
    if (!draft) {
      return
    }
    const { entry } = draft

    const nextName = renameName.trim()
    if (nextName.length === 0) {
      setErrorMessage('Name is required.')
      return
    }
    if (/[/\\]/u.test(nextName)) {
      setErrorMessage('Name cannot include path separators.')
      return
    }

    const parentPath = getPathDirname(entry.relativePath)
    const nextRelativePath = joinRelativePath(parentPath, nextName)
    if (normalizeEntryPath(nextRelativePath) === normalizeEntryPath(entry.relativePath)) {
      cancelRenameEntry()
      return
    }

    isSubmittingRenameRef.current = true
    try {
      await onRenameEntry(entry.relativePath, nextRelativePath)
      undoStack.recordRename(entry.relativePath, nextRelativePath, entry.isDirectory)
      setErrorMessage(null)
      setSelectedEntryPaths(new Set([nextRelativePath]))
      setSelectionDirectoryPath(parentPath)
      selectionAnchorEntryPathRef.current = nextRelativePath
      if (entry.isDirectory) {
        setExpandedDirectories((current) => {
          if (!current.has(entry.relativePath)) {
            return current
          }

          const nextState = new Set(current)
          nextState.delete(entry.relativePath)
          nextState.add(nextRelativePath)
          return nextState
        })
      }
      await loadDirectory(parentPath)
      setRenameDraft(null)
      setRenameName('')
    } catch (error) {
      setErrorMessage(
        toUserFacingErrorMessage(error, 'The workspace item could not be renamed.', {
          itemKind: entry.isDirectory ? 'folder' : 'file',
        }),
      )
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
    isExplorerEditingRef,
    loadDirectory,
    onRenameEntry,
    renameDraft,
    renameName,
    replayPendingExplorerReload,
    selectionAnchorEntryPathRef,
    setErrorMessage,
    setExpandedDirectories,
    setSelectedEntryPaths,
    setSelectionDirectoryPath,
    undoStack,
  ])

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
  }, [
    closeContextMenu,
    contextMenuState,
    isExplorerEditingRef,
    isSubmittingCreationRef,
    resetCreation,
    selectionAnchorEntryPathRef,
    setErrorMessage,
    setSelectedEntryPaths,
    setSelectionDirectoryPath,
  ])

  return {
    cancelRenameEntry,
    isSubmittingRenameRef,
    onRenameNameChange: setRenameName,
    prepareForCreation,
    renameDraft,
    renameInputRef,
    renameName,
    requestRenameEntry,
    resetRename,
    submitRenameEntry,
  }
}
