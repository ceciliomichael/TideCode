import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { toUserFacingErrorMessage } from '../../../lib/userFacingError'
import type { WorkspaceExplorerEntry } from '../../../types/chat'
import { getPathDirname } from '../../../lib/pathPresentation'
import type {
  PendingExplorerCreation,
  WorkspaceExplorerContextMenuState,
  WorkspaceExplorerErrorDialogState,
} from './workspaceExplorerPanelTypes'
import { ROOT_DIRECTORY_KEY, joinRelativePath } from './workspaceExplorerPanelUtils'

interface UseWorkspaceExplorerCreationOptions {
  closeContextMenu: () => void
  contextMenuState: WorkspaceExplorerContextMenuState | null
  directoryEntriesByPath: Record<string, WorkspaceExplorerEntry[]>
  loadDirectory: (relativePath?: string) => Promise<void>
  onCreateEntry: (relativePath: string, isDirectory: boolean) => Promise<void>
  onOpenFile: (relativePath: string) => void
  showErrorDialog: (state: WorkspaceExplorerErrorDialogState) => void
  setErrorMessage: Dispatch<SetStateAction<string | null>>
  setExpandedDirectories: Dispatch<SetStateAction<Set<string>>>
}

export function useWorkspaceExplorerCreation({
  closeContextMenu,
  contextMenuState,
  directoryEntriesByPath,
  loadDirectory,
  onCreateEntry,
  onOpenFile,
  showErrorDialog,
  setErrorMessage,
  setExpandedDirectories,
}: UseWorkspaceExplorerCreationOptions) {
  const [creationDraft, setCreationDraft] = useState<PendingExplorerCreation | null>(null)
  const [creationName, setCreationName] = useState('')
  const creationInputRef = useRef<HTMLInputElement | null>(null)
  const isSubmittingCreationRef = useRef(false)

  useEffect(() => {
    if (!creationDraft) {
      return
    }

    const animationFrameId = window.requestAnimationFrame(() => {
      creationInputRef.current?.focus()
      creationInputRef.current?.select()
    })

    return () => {
      window.cancelAnimationFrame(animationFrameId)
    }
  }, [creationDraft])

  const startCreateEntry = useCallback(
    (isDirectory: boolean) => {
      const targetEntry = contextMenuState?.targetEntry ?? null
      const parentPath = targetEntry
        ? targetEntry.isDirectory
          ? targetEntry.relativePath
          : getPathDirname(targetEntry.relativePath)
        : ROOT_DIRECTORY_KEY

      closeContextMenu()
      setErrorMessage(null)
      setCreationDraft({
        isDirectory,
        parentPath,
      })
      setCreationName('')

      if (parentPath !== ROOT_DIRECTORY_KEY) {
        setExpandedDirectories((current) => new Set(current).add(parentPath))
        if (!directoryEntriesByPath[parentPath]) {
          void loadDirectory(parentPath)
        }
      }
    },
    [closeContextMenu, contextMenuState, directoryEntriesByPath, loadDirectory, setErrorMessage, setExpandedDirectories],
  )

  const cancelCreateEntry = useCallback(() => {
    isSubmittingCreationRef.current = false
    setCreationDraft(null)
    setCreationName('')
  }, [])

  const onCreationNameChange = useCallback((nextName: string) => {
    setCreationName(nextName)
  }, [])

  const submitCreateEntry = useCallback(async () => {
    const draft = creationDraft
    if (!draft) {
      return
    }

    const nextName = creationName.trim()
    if (nextName.length === 0) {
      setErrorMessage('Name is required.')
      return
    }
    if (/[/\\]/u.test(nextName)) {
      setErrorMessage('Name cannot include path separators.')
      window.requestAnimationFrame(() => creationInputRef.current?.focus())
      return
    }

    const nextRelativePath = joinRelativePath(draft.parentPath, nextName)
    isSubmittingCreationRef.current = true
    try {
      await onCreateEntry(nextRelativePath, draft.isDirectory)
    } catch (error) {
      setErrorMessage(null)
      showErrorDialog({
        message: toUserFacingErrorMessage(
          error,
          draft.isDirectory ? 'The folder could not be created.' : 'The file could not be created.',
          { itemKind: draft.isDirectory ? 'folder' : 'file' },
        ),
        title: draft.isDirectory ? 'Folder was not created' : 'File was not created',
      })
      return
    } finally {
      isSubmittingCreationRef.current = false
    }

    setErrorMessage(null)
    if (draft.isDirectory) {
      setExpandedDirectories((current) => new Set(current).add(nextRelativePath))
    }
    await Promise.all([
      loadDirectory(draft.parentPath),
      draft.isDirectory ? loadDirectory(nextRelativePath) : Promise.resolve(),
    ])
    setCreationDraft(null)
    setCreationName('')
    if (!draft.isDirectory) {
      onOpenFile(nextRelativePath)
    }
  }, [creationDraft, creationName, loadDirectory, onCreateEntry, onOpenFile, setErrorMessage, setExpandedDirectories, showErrorDialog])

  const resetCreation = useCallback(() => {
    isSubmittingCreationRef.current = false
    setCreationDraft(null)
    setCreationName('')
  }, [])

  return {
    cancelCreateEntry,
    creationDraft,
    creationInputRef,
    creationName,
    isSubmittingCreationRef,
    onCreationNameChange,
    resetCreation,
    startCreateEntry,
    submitCreateEntry,
  }
}
