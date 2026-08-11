import { useCallback, useRef, useState } from 'react'

interface UseWorkspaceExplorerDeleteOptions {
  closeContextMenu: () => void
  onDeleteEntry: (relativePaths: string[]) => Promise<void>
  runContextAction: (action: () => Promise<void>, shouldReload?: boolean) => Promise<boolean>
}

export function useWorkspaceExplorerDelete({
  closeContextMenu,
  onDeleteEntry,
  runContextAction,
}: UseWorkspaceExplorerDeleteOptions) {
  const [deletingEntryPaths, setDeletingEntryPaths] = useState<Set<string>>(() => new Set())
  const deletingEntryPathsRef = useRef<Set<string>>(new Set())

  const requestDeleteEntries = useCallback(
    async (targetRelativePaths: readonly string[]) => {
      const normalizedRelativePaths = Array.from(
        new Set(targetRelativePaths.map((relativePath) => relativePath.trim()).filter(Boolean)),
      ).filter(
        (relativePath) => !deletingEntryPathsRef.current.has(relativePath),
      )
      closeContextMenu()
      if (normalizedRelativePaths.length === 0) {
        return
      }

      const nextDeletingPaths = new Set(deletingEntryPathsRef.current)
      normalizedRelativePaths.forEach((relativePath) => nextDeletingPaths.add(relativePath))
      deletingEntryPathsRef.current = nextDeletingPaths
      setDeletingEntryPaths(nextDeletingPaths)

      try {
        await runContextAction(async () => {
          await onDeleteEntry(normalizedRelativePaths)
        })
      } finally {
        const remainingPaths = new Set(deletingEntryPathsRef.current)
        normalizedRelativePaths.forEach((relativePath) => remainingPaths.delete(relativePath))
        deletingEntryPathsRef.current = remainingPaths
        setDeletingEntryPaths(remainingPaths)
      }
    },
    [closeContextMenu, onDeleteEntry, runContextAction],
  )

  const resetDeletingEntries = useCallback(() => {
    const emptyPaths = new Set<string>()
    deletingEntryPathsRef.current = emptyPaths
    setDeletingEntryPaths(emptyPaths)
  }, [])

  return {
    deletingEntryPaths,
    requestDeleteEntries,
    resetDeletingEntries,
  }
}
