import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from 'react'
import type { WorkspaceExplorerEntry } from '../../../types/chat'
import {
  ROOT_DIRECTORY_KEY,
  getAncestorDirectoryPaths,
  shouldSyncActiveFileAncestors,
  toDirectoryKey,
} from './workspaceExplorerPanelUtils'

interface ReloadExplorerTreeOptions {
  force?: boolean
}

interface UseWorkspaceExplorerTreeOptions {
  activeFilePath: string | null
  isExplorerEditingRef: MutableRefObject<boolean>
  isOpen: boolean
  pendingExplorerReloadRef: MutableRefObject<boolean>
  setErrorMessage: Dispatch<SetStateAction<string | null>>
  treeContainerRef: RefObject<HTMLDivElement>
  workspaceRootPath: string | null
}

export function useWorkspaceExplorerTree({
  activeFilePath,
  isExplorerEditingRef,
  isOpen,
  pendingExplorerReloadRef,
  setErrorMessage,
  treeContainerRef,
  workspaceRootPath,
}: UseWorkspaceExplorerTreeOptions) {
  const [directoryEntriesByPath, setDirectoryEntriesByPath] = useState<Record<string, WorkspaceExplorerEntry[]>>({})
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(() => new Set())
  const [loadingDirectories, setLoadingDirectories] = useState<Set<string>>(() => new Set())
  const lastSyncedActiveFileRef = useRef<{ workspacePath: string | null; filePath: string | null }>({
    workspacePath: null,
    filePath: null,
  })
  const lastScrolledActiveFileRef = useRef<string | null>(null)

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
    [setErrorMessage, workspaceRootPath],
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
  }, [treeContainerRef])

  const reloadExplorerTree = useCallback((options?: ReloadExplorerTreeOptions) => {
    if (isExplorerEditingRef.current && !options?.force) {
      pendingExplorerReloadRef.current = true
      return Promise.resolve()
    }

    const directoriesToReload = [ROOT_DIRECTORY_KEY, ...expandedDirectories]
    return preserveTreeScrollDuring(async () => {
      await Promise.all(directoriesToReload.map((directoryPath) => loadDirectory(directoryPath, { hideError: true })))
    })
  }, [expandedDirectories, isExplorerEditingRef, loadDirectory, pendingExplorerReloadRef, preserveTreeScrollDuring])
  const reloadExplorerTreeRef = useRef(reloadExplorerTree)

  useEffect(() => {
    reloadExplorerTreeRef.current = reloadExplorerTree
  }, [reloadExplorerTree])

  const rootEntries = useMemo(
    () => directoryEntriesByPath[ROOT_DIRECTORY_KEY] ?? [],
    [directoryEntriesByPath],
  )

  const resetTree = useCallback(() => {
    setDirectoryEntriesByPath({})
    setExpandedDirectories(new Set())
    setLoadingDirectories(new Set())
    lastSyncedActiveFileRef.current = { workspacePath: null, filePath: null }
    lastScrolledActiveFileRef.current = null
  }, [])

  useEffect(() => {
    if (!isOpen || !workspaceRootPath) {
      return
    }

    let isDisposed = false
    const unsubscribeWorkspaceChanges = window.echosphereWorkspace.onExplorerChange((event) => {
      if (!isDisposed && event.workspaceRootPath === workspaceRootPath) {
        void reloadExplorerTreeRef.current()
      }
    })

    void window.echosphereWorkspace.watchExplorerChanges({
      relativeDirectoryPaths: [ROOT_DIRECTORY_KEY],
      workspaceRootPath,
    }).catch((error) => {
      console.error('Failed to watch workspace explorer changes', error)
    })
    void loadDirectory(ROOT_DIRECTORY_KEY)

    return () => {
      isDisposed = true
      unsubscribeWorkspaceChanges()
      void window.echosphereWorkspace
        .updateExplorerWatchPaths({
          relativeDirectoryPaths: [ROOT_DIRECTORY_KEY],
          workspaceRootPath,
        })
        .catch((error) => {
          console.error('Failed to reset workspace explorer watch paths', error)
        })
        .finally(() => {
          void window.echosphereWorkspace.unwatchExplorerChanges({ workspaceRootPath }).catch((error) => {
            console.error('Failed to unwatch workspace explorer changes', error)
          })
        })
    }
  }, [isOpen, loadDirectory, workspaceRootPath])

  useEffect(() => {
    if (!isOpen || !workspaceRootPath) {
      return
    }
    void window.echosphereWorkspace.updateExplorerWatchPaths({
      relativeDirectoryPaths: [ROOT_DIRECTORY_KEY, ...expandedDirectories],
      workspaceRootPath,
    }).catch((error) => {
      console.error('Failed to update workspace explorer watch paths', error)
    })
  }, [expandedDirectories, isOpen, workspaceRootPath])

  useEffect(() => {
    if (!isOpen || !workspaceRootPath || !activeFilePath) {
      if (!activeFilePath) {
        lastSyncedActiveFileRef.current = { workspacePath: null, filePath: null }
      }
      return
    }

    if (!shouldSyncActiveFileAncestors({
      activeFilePath,
      activeWorkspacePath: workspaceRootPath,
      lastSyncedFilePath: lastSyncedActiveFileRef.current.filePath,
      lastSyncedWorkspacePath: lastSyncedActiveFileRef.current.workspacePath,
    })) {
      return
    }

    lastSyncedActiveFileRef.current = { workspacePath: workspaceRootPath, filePath: activeFilePath }
    const ancestorDirectoryPaths = getAncestorDirectoryPaths(activeFilePath)
    if (ancestorDirectoryPaths.length === 0) {
      return
    }

    const newlyExpandedPaths = ancestorDirectoryPaths.filter((directoryPath) => !expandedDirectories.has(directoryPath))
    setExpandedDirectories((current) => {
      const nextState = new Set(current)
      let hasChanges = false
      for (const directoryPath of ancestorDirectoryPaths) {
        if (!nextState.has(directoryPath)) {
          nextState.add(directoryPath)
          hasChanges = true
        }
      }
      return hasChanges ? nextState : current
    })
    if (newlyExpandedPaths.length > 0) {
      void Promise.all(newlyExpandedPaths.map((directoryPath) => loadDirectory(directoryPath)))
    }
  }, [activeFilePath, expandedDirectories, isOpen, loadDirectory, workspaceRootPath])

  useEffect(() => {
    if (!isOpen || !activeFilePath || lastScrolledActiveFileRef.current === activeFilePath) {
      return
    }
    lastScrolledActiveFileRef.current = activeFilePath

    const animationFrameId = window.requestAnimationFrame(() => {
      const containerElement = treeContainerRef.current
      if (!containerElement) {
        return
      }
      const entryButtons = Array.from(containerElement.querySelectorAll<HTMLButtonElement>('[data-workspace-entry-path]'))
      entryButtons.find((entryButton) => entryButton.dataset.workspaceEntryPath === activeFilePath)?.scrollIntoView({
        block: 'nearest',
      })
    })
    return () => {
      window.cancelAnimationFrame(animationFrameId)
    }
  }, [activeFilePath, directoryEntriesByPath, expandedDirectories, isOpen, treeContainerRef])

  return {
    directoryEntriesByPath,
    expandedDirectories,
    loadDirectory,
    loadingDirectories,
    reloadExplorerTree,
    resetTree,
    rootEntries,
    setExpandedDirectories,
  }
}
