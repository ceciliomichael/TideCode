import { useCallback, useRef } from 'react'

// ---- Undo entry types ----

interface DeleteFileUndoEntry {
  type: 'delete-file'
  relativePath: string
  content: string
}

interface DeleteDirectoryUndoEntry {
  type: 'delete-directory'
  relativePath: string
  /** Flat list of files that were inside the directory, with their content. */
  files: Array<{ relativePath: string; content: string }>
}

interface CreateUndoEntry {
  type: 'create'
  relativePath: string
  isDirectory: boolean
}

interface RenameUndoEntry {
  type: 'rename'
  oldPath: string
  newPath: string
  isDirectory: boolean
}

interface MoveUndoEntry {
  type: 'move'
  originalRelativePath: string
  resultRelativePath: string
}

interface ImportUndoEntry {
  type: 'import'
  resultRelativePath: string
}

interface BatchDeleteUndoEntry {
  type: 'batch-delete'
  entries: Array<DeleteFileUndoEntry | DeleteDirectoryUndoEntry>
}

type UndoEntry =
  | DeleteFileUndoEntry
  | DeleteDirectoryUndoEntry
  | CreateUndoEntry
  | RenameUndoEntry
  | MoveUndoEntry
  | ImportUndoEntry
  | BatchDeleteUndoEntry

const MAX_UNDO_STACK_SIZE = 50

// ---- Hook ----

interface UseWorkspaceExplorerUndoStackOptions {
  workspaceRootPath: string | null
  reloadExplorerTree: () => Promise<void>
}

export function useWorkspaceExplorerUndoStack({
  workspaceRootPath,
  reloadExplorerTree,
}: UseWorkspaceExplorerUndoStackOptions) {
  const undoStackRef = useRef<UndoEntry[]>([])

  const pushUndo = useCallback((entry: UndoEntry) => {
    undoStackRef.current.push(entry)
    if (undoStackRef.current.length > MAX_UNDO_STACK_SIZE) {
      undoStackRef.current.shift()
    }
  }, [])

  // Recursively collect all file paths and contents in a directory
  const snapshotDirectory = useCallback(
    async (directoryRelativePath: string): Promise<Array<{ relativePath: string; content: string }>> => {
      if (!workspaceRootPath) return []

      const files: Array<{ relativePath: string; content: string }> = []
      const entries = await window.echosphereWorkspace.listDirectory({
        relativePath: directoryRelativePath,
        workspaceRootPath,
        visibility: 'explorer',
      })

      for (const entry of entries) {
        if (entry.isDirectory) {
          const nested = await snapshotDirectory(entry.relativePath)
          files.push(...nested)
        } else {
          try {
            const result = await window.echosphereWorkspace.readFile({
              relativePath: entry.relativePath,
              workspaceRootPath,
            })
            if (!result.isBinary) {
              files.push({ relativePath: entry.relativePath, content: result.content })
            }
          } catch {
            // Skip files that can't be read (binary, locked, etc.)
          }
        }
      }

      return files
    },
    [workspaceRootPath],
  )

  // Record a delete before it happens, so we can undo it
  const recordDeleteEntries = useCallback(
    async (relativePaths: string[]) => {
      if (!workspaceRootPath) return

      const subEntries: Array<DeleteFileUndoEntry | DeleteDirectoryUndoEntry> = []

      for (const relativePath of relativePaths) {
        // First try reading as a file
        try {
          const result = await window.echosphereWorkspace.readFile({
            relativePath,
            workspaceRootPath,
          })
          if (!result.isBinary) {
            subEntries.push({ type: 'delete-file', relativePath, content: result.content })
          }
          continue
        } catch {
          // readFile failed — this is likely a directory
        }

        // Fall back to directory snapshot
        try {
          const files = await snapshotDirectory(relativePath)
          subEntries.push({ type: 'delete-directory', relativePath, files })
        } catch {
          // Can't snapshot directory either — won't be able to undo
        }
      }

      if (subEntries.length === 0) return

      if (subEntries.length === 1) {
        pushUndo(subEntries[0])
      } else {
        pushUndo({ type: 'batch-delete', entries: subEntries })
      }
    },
    [pushUndo, snapshotDirectory, workspaceRootPath],
  )

  const recordCreate = useCallback(
    (relativePath: string, isDirectory: boolean) => {
      pushUndo({ type: 'create', relativePath, isDirectory })
    },
    [pushUndo],
  )

  const recordRename = useCallback(
    (oldPath: string, newPath: string, isDirectory: boolean) => {
      pushUndo({ type: 'rename', oldPath, newPath, isDirectory })
    },
    [pushUndo],
  )

  const recordMove = useCallback(
    (originalRelativePath: string, resultRelativePath: string) => {
      pushUndo({ type: 'move', originalRelativePath, resultRelativePath })
    },
    [pushUndo],
  )

  const recordImport = useCallback(
    (resultRelativePath: string) => {
      pushUndo({ type: 'import', resultRelativePath })
    },
    [pushUndo],
  )

  // Execute undo of a single delete entry
  const undoDeleteEntry = useCallback(
    async (entry: DeleteFileUndoEntry | DeleteDirectoryUndoEntry) => {
      if (!workspaceRootPath) return

      if (entry.type === 'delete-file') {
        await window.echosphereWorkspace.createEntry({
          isDirectory: false,
          relativePath: entry.relativePath,
          workspaceRootPath,
        })
        await window.echosphereWorkspace.writeFile({
          content: entry.content,
          relativePath: entry.relativePath,
          workspaceRootPath,
        })
      } else if (entry.type === 'delete-directory') {
        await window.echosphereWorkspace.createEntry({
          isDirectory: true,
          relativePath: entry.relativePath,
          workspaceRootPath,
        })
        // Restore all files inside the directory
        for (const file of entry.files) {
          // Ensure parent directories exist
          const parentSegments = file.relativePath.split('/')
          for (let i = 1; i < parentSegments.length; i++) {
            const parentPath = parentSegments.slice(0, i).join('/')
            try {
              await window.echosphereWorkspace.createEntry({
                isDirectory: true,
                relativePath: parentPath,
                workspaceRootPath,
              })
            } catch {
              // Directory may already exist
            }
          }
          try {
            await window.echosphereWorkspace.createEntry({
              isDirectory: false,
              relativePath: file.relativePath,
              workspaceRootPath,
            })
          } catch {
            // File may already exist
          }
          await window.echosphereWorkspace.writeFile({
            content: file.content,
            relativePath: file.relativePath,
            workspaceRootPath,
          })
        }
      }
    },
    [workspaceRootPath],
  )

  const undo = useCallback(async (): Promise<boolean> => {
    if (!workspaceRootPath) return false

    const entry = undoStackRef.current.pop()
    if (!entry) return false

    try {
      switch (entry.type) {
        case 'delete-file':
        case 'delete-directory':
          await undoDeleteEntry(entry)
          break

        case 'batch-delete':
          // Restore in reverse order
          for (const subEntry of [...entry.entries].reverse()) {
            await undoDeleteEntry(subEntry)
          }
          break

        case 'create':
          await window.echosphereWorkspace.deleteEntry({
            relativePath: entry.relativePath,
            workspaceRootPath,
          })
          break

        case 'rename':
          await window.echosphereWorkspace.renameEntry({
            relativePath: entry.newPath,
            nextRelativePath: entry.oldPath,
            workspaceRootPath,
          })
          break

        case 'move':
          // Move it back by renaming
          await window.echosphereWorkspace.renameEntry({
            relativePath: entry.resultRelativePath,
            nextRelativePath: entry.originalRelativePath,
            workspaceRootPath,
          })
          break

        case 'import':
          await window.echosphereWorkspace.deleteEntry({
            relativePath: entry.resultRelativePath,
            workspaceRootPath,
          })
          break
      }

      await reloadExplorerTree()
      return true
    } catch (error) {
      console.error('Failed to undo explorer operation:', error)
      return false
    }
  }, [reloadExplorerTree, undoDeleteEntry, workspaceRootPath])

  const canUndo = useCallback(() => undoStackRef.current.length > 0, [])

  const clearUndoStack = useCallback(() => {
    undoStackRef.current = []
  }, [])

  return {
    canUndo,
    clearUndoStack,
    recordCreate,
    recordDeleteEntries,
    recordImport,
    recordMove,
    recordRename,
    undo,
  }
}
