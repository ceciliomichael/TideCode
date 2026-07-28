import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { CreateWorkspaceCheckpointInput, UserMessageRunCheckpoint } from '../../src/types/chat'
import { captureKanbanBoardSnapshotIfNeeded, readKanbanBoardSnapshot } from '../kanban/checkpoints'
import { getKanbanBoardData, replaceKanbanBoardData } from '../kanban/store'
import { isGitignored, loadGitignoreMatchers, shouldIgnoreWorkspaceEntry } from './gitignoreMatcher'

interface WorkspaceCheckpointEntry {
  existed: boolean
  isDirectory?: boolean
  missingDirectories?: string[]
  relativePath: string
  snapshotFileName?: string
}

interface WorkspaceCheckpointDocument {
  createdAt: number
  entries: WorkspaceCheckpointEntry[]
  id: string
  // Directories that existed before a terminal execution (pre-state snapshot).
  // Used during post-state to detect newly created directories.
  preStateTrackedDirectories?: string[]
  workspaceRootPath: string
}

interface WorkspaceCheckpointStore {
  captureCreatedDirectoriesState: (checkpointId: string, currentDirPaths: string[]) => Promise<void>
  captureCreatedFilesState: (checkpointId: string, currentFilePaths: string[]) => Promise<void>
  captureFileState: (checkpointId: string, absolutePath: string) => Promise<void>
  createCheckpoint: (input: CreateWorkspaceCheckpointInput) => Promise<UserMessageRunCheckpoint>
  createRedoCheckpointFromSource: (sourceCheckpointId: string) => Promise<UserMessageRunCheckpoint>
  createRedoCheckpointFromSources: (sourceCheckpointIds: string[]) => Promise<UserMessageRunCheckpoint>
  pruneUnchangedEntries: (checkpointId: string) => Promise<void>
  restoreCheckpoint: (checkpointId: string) => Promise<string>
  restoreCheckpointSequence: (checkpointIds: string[]) => Promise<string>
  savePreStateDirectories: (checkpointId: string, directoryPaths: string[]) => Promise<void>
}

const CHECKPOINTS_DIRECTORY_NAME = 'workspace-checkpoints'
const MANIFEST_FILE_NAME = 'manifest.json'
const SNAPSHOTS_DIRECTORY_NAME = 'snapshots'
const MANIFEST_READ_RETRY_DELAY_MS = 25

function normalizePath(value: string) {
  return path.resolve(value.trim())
}

function normalizeRelativePath(value: string) {
  const normalizedPath = value.replace(/\\/g, '/')
  return process.platform === 'win32' ? normalizedPath.toLowerCase() : normalizedPath
}

async function ensureDirectory(directoryPath: string) {
  await fs.mkdir(directoryPath, { recursive: true })
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

function splitRelativePathSegments(value: string) {
  return value.split(/[\\/]+/).filter(Boolean)
}

async function getMissingParentDirectories(workspaceRootPath: string, relativeFilePath: string) {
  const relativeDirectoryPath = path.dirname(relativeFilePath)
  if (relativeDirectoryPath === '.' || relativeDirectoryPath.trim().length === 0) {
    return []
  }

  const segments = splitRelativePathSegments(relativeDirectoryPath)
  const missingDirectories: string[] = []
  let currentRelativePath = ''
  let hasMissingAncestor = false

  for (const segment of segments) {
    currentRelativePath = currentRelativePath.length > 0 ? path.join(currentRelativePath, segment) : segment

    if (hasMissingAncestor) {
      missingDirectories.push(currentRelativePath)
      continue
    }

    const absoluteDirectoryPath = path.join(workspaceRootPath, currentRelativePath)
    const directoryStats = await fs.stat(absoluteDirectoryPath).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }

      throw error
    })

    if (!directoryStats) {
      hasMissingAncestor = true
      missingDirectories.push(currentRelativePath)
      continue
    }

    if (!directoryStats.isDirectory()) {
      throw new Error(`Checkpoint restore expects a directory at ${absoluteDirectoryPath}`)
    }
  }

  return missingDirectories
}

export function createWorkspaceCheckpointStore(storageRootPath: string): WorkspaceCheckpointStore {
  const checkpointLocks = new Map<string, Promise<void>>()

  function getCheckpointsDirectoryPath() {
    return path.join(storageRootPath, CHECKPOINTS_DIRECTORY_NAME)
  }

  function getCheckpointDirectoryPath(checkpointId: string) {
    return path.join(getCheckpointsDirectoryPath(), checkpointId)
  }

  function getCheckpointManifestPath(checkpointId: string) {
    return path.join(getCheckpointDirectoryPath(checkpointId), MANIFEST_FILE_NAME)
  }

  function getCheckpointSnapshotsDirectoryPath(checkpointId: string) {
    return path.join(getCheckpointDirectoryPath(checkpointId), SNAPSHOTS_DIRECTORY_NAME)
  }

  async function writeManifest(document: WorkspaceCheckpointDocument) {
    await ensureDirectory(getCheckpointDirectoryPath(document.id))
    await fs.writeFile(getCheckpointManifestPath(document.id), JSON.stringify(document, null, 2), 'utf8')
  }

  async function readManifest(checkpointId: string) {
    const manifestPath = getCheckpointManifestPath(checkpointId)
    try {
      const raw = await fs.readFile(manifestPath, 'utf8')
      if (raw.trim().length === 0) {
        throw new SyntaxError(`Checkpoint manifest is empty: ${manifestPath}`)
      }

      return JSON.parse(raw) as WorkspaceCheckpointDocument
    } catch (error) {
      if (!(error instanceof SyntaxError)) {
        throw error
      }

      await sleep(MANIFEST_READ_RETRY_DELAY_MS)
      const raw = await fs.readFile(manifestPath, 'utf8')
      if (raw.trim().length === 0) {
        throw new Error(`Checkpoint manifest is unreadable: ${manifestPath}`)
      }

      try {
        return JSON.parse(raw) as WorkspaceCheckpointDocument
      } catch {
        throw new Error(`Checkpoint manifest is unreadable: ${manifestPath}`)
      }
    }
  }

  function normalizeCheckpointIdList(checkpointIds: string[]) {
    return Array.from(
      new Set(
        checkpointIds
          .map((checkpointId) => checkpointId.trim())
          .filter((checkpointId) => checkpointId.length > 0),
      ),
    )
  }

  async function withCheckpointLock<T>(checkpointId: string, operation: () => Promise<T>) {
    const previousOperation = checkpointLocks.get(checkpointId) ?? Promise.resolve()
    const nextOperation = previousOperation.catch(() => undefined).then(operation)
    checkpointLocks.set(checkpointId, nextOperation.then(() => undefined, () => undefined))

    try {
      return await nextOperation
    } finally {
      const activeOperation = checkpointLocks.get(checkpointId)
      if (activeOperation === checkpointLocks.get(checkpointId)) {
        activeOperation?.finally(() => {
          if (checkpointLocks.get(checkpointId) === activeOperation) {
            checkpointLocks.delete(checkpointId)
          }
        }).catch(() => {
          // Lock cleanup should never surface as an unhandled rejection.
        })
      }
    }
  }

  return {
    async createCheckpoint(input: CreateWorkspaceCheckpointInput) {
      const workspaceRootPath = normalizePath(input.workspaceRootPath)
      const workspaceStats = await fs.stat(workspaceRootPath).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error(`Workspace path does not exist: ${workspaceRootPath}`)
        }

        throw error
      })

      if (!workspaceStats.isDirectory()) {
        throw new Error(`Workspace checkpoint root must be a directory: ${workspaceRootPath}`)
      }

      await ensureDirectory(getCheckpointsDirectoryPath())

      const checkpoint: UserMessageRunCheckpoint = {
        createdAt: Date.now(),
        id: randomUUID(),
      }

      await writeManifest({
        createdAt: checkpoint.createdAt,
        entries: [],
        id: checkpoint.id,
        workspaceRootPath,
      })

      return checkpoint
    },

    async captureFileState(checkpointId: string, absolutePath: string) {
      await withCheckpointLock(checkpointId, async () => {
        const manifest = await readManifest(checkpointId)
        const normalizedTargetPath = normalizePath(absolutePath)
        const relativePath = path.relative(manifest.workspaceRootPath, normalizedTargetPath)
        if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
          return
        }
        const normalizedRelativePath = normalizeRelativePath(relativePath)
        if (manifest.entries.some((entry) => normalizeRelativePath(entry.relativePath) === normalizedRelativePath)) {
          return
        }

        try {
          const targetStats = await fs.stat(normalizedTargetPath)
          if (targetStats.isDirectory()) {
            manifest.entries.push({
              existed: true,
              isDirectory: true,
              relativePath,
            })
          } else if (targetStats.isFile()) {
            const snapshotFileName = `${manifest.entries.length}.txt`
            await ensureDirectory(getCheckpointSnapshotsDirectoryPath(checkpointId))
            await fs.writeFile(
              path.join(getCheckpointSnapshotsDirectoryPath(checkpointId), snapshotFileName),
              await fs.readFile(normalizedTargetPath),
            )
            manifest.entries.push({
              existed: true,
              isDirectory: false,
              relativePath,
              snapshotFileName,
            })
          } else {
            return
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error
          }

          manifest.entries.push({
            existed: false,
            missingDirectories: await getMissingParentDirectories(manifest.workspaceRootPath, relativePath),
            relativePath,
          })
        }

        await writeManifest(manifest)
      })
    },

    async captureCreatedFilesState(checkpointId: string, currentFilePaths: string[]) {
      await withCheckpointLock(checkpointId, async () => {
        const manifest = await readManifest(checkpointId)
        const existingEntriesSet = new Set(manifest.entries.map((entry) => normalizeRelativePath(entry.relativePath)))

        // Build the set of directories that were known to exist BEFORE the terminal ran,
        // derived from pre-state manifest entries. We cannot call getMissingParentDirectories
        // here because the terminal has already created those directories on disk, which
        // would cause it to return [] and the restore would never clean them up.
        const knownPreStateNormalizedDirs = new Set<string>()
        for (const entry of manifest.entries) {
          const segments = splitRelativePathSegments(path.dirname(normalizeRelativePath(entry.relativePath)))
          let currentDir = ''
          for (const segment of segments) {
            currentDir = currentDir ? `${currentDir}/${segment}` : segment
            knownPreStateNormalizedDirs.add(currentDir)
          }
        }

        let manifestChanged = false

        for (const absolutePath of currentFilePaths) {
          const normalizedTargetPath = normalizePath(absolutePath)
          const relativePath = path.relative(manifest.workspaceRootPath, normalizedTargetPath)
          if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
            continue
          }

          const normalizedRelativePath = normalizeRelativePath(relativePath)
          if (existingEntriesSet.has(normalizedRelativePath)) {
            continue
          }

          // Walk up the directory tree to find which parent directories did NOT exist
          // before the terminal ran (i.e., are NOT in the pre-state known dirs set).
          const relativeDir = path.dirname(relativePath)
          const dirSegments = relativeDir === '.' || relativeDir.length === 0
            ? []
            : splitRelativePathSegments(relativeDir)

          const missingDirectories: string[] = []
          let currentRelativeDir = ''
          let hasMissingAncestor = false

          for (const segment of dirSegments) {
            currentRelativeDir = currentRelativeDir ? path.join(currentRelativeDir, segment) : segment
            const normalizedCurrentDir = normalizeRelativePath(currentRelativeDir)
            if (hasMissingAncestor || !knownPreStateNormalizedDirs.has(normalizedCurrentDir)) {
              hasMissingAncestor = true
              missingDirectories.push(currentRelativeDir)
            }
          }

          manifest.entries.push({
            existed: false,
            missingDirectories,
            relativePath,
          })
          existingEntriesSet.add(normalizedRelativePath)
          // Register newly-discovered dirs so siblings don't double-mark them
          const newDirSegments = splitRelativePathSegments(normalizeRelativePath(relativeDir === '.' ? '' : relativeDir))
          let cumulativeDir = ''
          for (const segment of newDirSegments) {
            cumulativeDir = cumulativeDir ? `${cumulativeDir}/${segment}` : segment
            knownPreStateNormalizedDirs.add(cumulativeDir)
          }
          manifestChanged = true
        }

        if (manifestChanged) {
          await writeManifest(manifest)
        }
      })
    },

    async savePreStateDirectories(checkpointId: string, directoryPaths: string[]) {
      await withCheckpointLock(checkpointId, async () => {
        const manifest = await readManifest(checkpointId)
        const relativeDirectories = directoryPaths
          .map((absolutePath) => path.relative(manifest.workspaceRootPath, normalizePath(absolutePath)))
          .filter((relative) => !relative.startsWith('..') && !path.isAbsolute(relative))
        manifest.preStateTrackedDirectories = relativeDirectories
        await writeManifest(manifest)
      })
    },

    async captureCreatedDirectoriesState(checkpointId: string, currentDirPaths: string[]) {
      await withCheckpointLock(checkpointId, async () => {
        const manifest = await readManifest(checkpointId)
        // Build normalized set of directories that existed BEFORE the terminal ran.
        const preStateDirSet = new Set(
          (manifest.preStateTrackedDirectories ?? []).map(normalizeRelativePath),
        )
        const existingEntrySet = new Set(manifest.entries.map((e) => normalizeRelativePath(e.relativePath)))
        let manifestChanged = false

        for (const absolutePath of currentDirPaths) {
          const normalizedTargetPath = normalizePath(absolutePath)
          const relativePath = path.relative(manifest.workspaceRootPath, normalizedTargetPath)
          if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
            continue
          }

          const normalizedRelativePath = normalizeRelativePath(relativePath)
          // Skip dirs that existed before the terminal ran, or that are already tracked.
          if (preStateDirSet.has(normalizedRelativePath) || existingEntrySet.has(normalizedRelativePath)) {
            continue
          }

          // Register the new directory as a deletion target for restore.
          // fs.rm with recursive:true handles the whole subtree, so registering
          // a parent dir implicitly removes its children too. Registering nested
          // dirs is harmless since ENOENT is silently ignored during restore.
          manifest.entries.push({
            existed: false,
            missingDirectories: [],
            relativePath,
          })
          existingEntrySet.add(normalizedRelativePath)
          manifestChanged = true
        }

        if (manifestChanged) {
          await writeManifest(manifest)
        }
      })
    },

    async pruneUnchangedEntries(checkpointId: string) {
      await withCheckpointLock(checkpointId, async () => {
        const manifest = await readManifest(checkpointId)
        const activeEntries: WorkspaceCheckpointEntry[] = []

        for (const entry of manifest.entries) {
          if (!entry.existed || entry.isDirectory || !entry.snapshotFileName) {
            activeEntries.push(entry)
            continue
          }

          const absolutePath = path.join(manifest.workspaceRootPath, entry.relativePath)
          const snapshotPath = path.join(getCheckpointSnapshotsDirectoryPath(checkpointId), entry.snapshotFileName)

          try {
            const snapshotBuffer = await fs.readFile(snapshotPath)
            const currentBuffer = await fs.readFile(absolutePath)

            // Keep the entry ONLY if the file was modified by the tool!
            if (!snapshotBuffer.equals(currentBuffer)) {
              activeEntries.push(entry)
            }
          } catch {
            // File was deleted by the tool, so keep entry to recreate it on restore
            activeEntries.push(entry)
          }
        }

        if (activeEntries.length !== manifest.entries.length) {
          manifest.entries = activeEntries
          await writeManifest(manifest)
        }
      })
    },

    async restoreCheckpoint(checkpointId: string) {
      return withCheckpointLock(checkpointId, async () => {

        const manifest = await readManifest(checkpointId)
        const restoreEntries = [...manifest.entries].reverse()
        const directoryCleanupCandidates = new Set<string>()

        for (const entry of restoreEntries) {
          const absolutePath = path.join(manifest.workspaceRootPath, entry.relativePath)

          if (!entry.existed) {
            await fs.chmod(absolutePath, 0o666).catch(() => undefined)
            await fs.rm(absolutePath, { force: true, recursive: true }).catch((error: unknown) => {
              if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                console.warn(`Failed to remove created entry during restore: ${absolutePath}`, error)
              }
            })

            for (const missingDirectory of entry.missingDirectories ?? []) {
              directoryCleanupCandidates.add(missingDirectory)
            }
            continue
          }

          if (entry.isDirectory) {
            await ensureDirectory(absolutePath)
            continue
          }

          if (!entry.snapshotFileName) {
            throw new Error(`Checkpoint snapshot is missing for ${entry.relativePath}`)
          }

          const snapshotPath = path.join(getCheckpointSnapshotsDirectoryPath(checkpointId), entry.snapshotFileName)
          const snapshotBuffer = await fs.readFile(snapshotPath)
          const existingStats = await fs.stat(absolutePath).catch(() => null)

          if (existingStats?.isDirectory()) {
            await fs.rm(absolutePath, { force: true, recursive: true }).catch(() => undefined)
          }

          await ensureDirectory(path.dirname(absolutePath))
          try {
            await fs.chmod(absolutePath, 0o666).catch(() => undefined)
            await fs.writeFile(absolutePath, snapshotBuffer)
          } catch (error) {
            try {
              await fs.unlink(absolutePath).catch(() => undefined)
              await fs.writeFile(absolutePath, snapshotBuffer)
            } catch (writeError) {
              console.warn(`Failed to restore file ${absolutePath}:`, writeError)
            }
          }
        }

        const orderedDirectories = Array.from(directoryCleanupCandidates).sort((left, right) => {
          return splitRelativePathSegments(right).length - splitRelativePathSegments(left).length
        })

        for (const relativeDirectory of orderedDirectories) {
          const absoluteDirectoryPath = path.join(manifest.workspaceRootPath, relativeDirectory)
          await fs.rmdir(absoluteDirectoryPath).catch((error: unknown) => {
            const code = (error as NodeJS.ErrnoException).code
            if (code === 'ENOENT' || code === 'ENOTEMPTY' || code === 'EEXIST' || code === 'EPERM') {
              return
            }

            throw error
          })
        }

        const kanbanSnapshot = await readKanbanBoardSnapshot(checkpointId)
        if (kanbanSnapshot) {
          await replaceKanbanBoardData({
            cards: kanbanSnapshot.boardData.cards,
            revision: kanbanSnapshot.boardData.revision,
            workspacePath: kanbanSnapshot.workspacePath,
          })
        }

        return manifest.workspaceRootPath
      })
    },

    async restoreCheckpointSequence(checkpointIds: string[]) {
      const normalizedCheckpointIds = normalizeCheckpointIdList(checkpointIds)
      if (normalizedCheckpointIds.length === 0) {
        throw new Error('At least one checkpoint is required to restore a sequence.')
      }

      let workspaceRootPath = ''
      for (const checkpointId of [...normalizedCheckpointIds].reverse()) {
        workspaceRootPath = await this.restoreCheckpoint(checkpointId)
      }

      return workspaceRootPath
    },

    async createRedoCheckpointFromSource(sourceCheckpointId: string) {
      return this.createRedoCheckpointFromSources([sourceCheckpointId])
    },

    async createRedoCheckpointFromSources(sourceCheckpointIds: string[]) {
      const normalizedCheckpointIds = normalizeCheckpointIdList(sourceCheckpointIds)
      if (normalizedCheckpointIds.length === 0) {
        throw new Error('At least one checkpoint is required to create a redo snapshot.')
      }

      const sourceManifests = await Promise.all(normalizedCheckpointIds.map((checkpointId) => readManifest(checkpointId)))
      const workspaceRootPath = sourceManifests[0].workspaceRootPath

      for (const sourceManifest of sourceManifests) {
        if (sourceManifest.workspaceRootPath !== workspaceRootPath) {
          throw new Error('Redo checkpoints must come from the same workspace root.')
        }
      }

      const redoCheckpoint = await this.createCheckpoint({
        workspaceRootPath,
      })

      const absolutePaths = new Set<string>()
      for (const sourceManifest of sourceManifests) {
        for (const sourceEntry of sourceManifest.entries) {
          absolutePaths.add(path.join(workspaceRootPath, sourceEntry.relativePath))
        }
      }

      const sortedAbsolutePaths = Array.from(absolutePaths).sort((left, right) =>
        left.localeCompare(right, undefined, { sensitivity: 'base' }),
      )

      for (const absolutePath of sortedAbsolutePaths) {
        await this.captureFileState(redoCheckpoint.id, absolutePath)
      }

      const currentKanbanBoardData = await getKanbanBoardData({ workspacePath: workspaceRootPath })
      await captureKanbanBoardSnapshotIfNeeded({
        boardData: currentKanbanBoardData,
        checkpointId: redoCheckpoint.id,
        workspacePath: workspaceRootPath,
      })

      return redoCheckpoint
    },
  }
}

let defaultWorkspaceCheckpointStorePromise: Promise<WorkspaceCheckpointStore> | null = null

async function getDefaultWorkspaceCheckpointStore() {
  if (!defaultWorkspaceCheckpointStorePromise) {
    defaultWorkspaceCheckpointStorePromise = import('../history/paths').then(({ getHistoryDirectoryPath }) =>
      createWorkspaceCheckpointStore(getHistoryDirectoryPath()),
    )
  }

  return defaultWorkspaceCheckpointStorePromise
}

export async function createWorkspaceCheckpoint(input: CreateWorkspaceCheckpointInput) {
  return (await getDefaultWorkspaceCheckpointStore()).createCheckpoint(input)
}

export async function captureWorkspaceCheckpointFileState(checkpointId: string, absolutePath: string) {
  return (await getDefaultWorkspaceCheckpointStore()).captureFileState(checkpointId, absolutePath)
}

export async function restoreWorkspaceCheckpoint(checkpointId: string) {
  const workspaceCheckpointStore = await getDefaultWorkspaceCheckpointStore()
  const workspaceRootPath = await workspaceCheckpointStore.restoreCheckpoint(checkpointId)
  void import('./explorerWatch')
    .then(({ notifyWorkspaceExplorerChange }) => {
      notifyWorkspaceExplorerChange(workspaceRootPath)
    })
    .catch(() => {
      // Node-only tests import checkpoint helpers without the Electron runtime.
    })
}

export async function createWorkspaceRedoCheckpointFromSource(sourceCheckpointId: string) {
  const workspaceCheckpointStore = await getDefaultWorkspaceCheckpointStore()
  return workspaceCheckpointStore.createRedoCheckpointFromSource(sourceCheckpointId)
}

export async function createWorkspaceRedoCheckpointFromSources(sourceCheckpointIds: string[]) {
  const workspaceCheckpointStore = await getDefaultWorkspaceCheckpointStore()
  return workspaceCheckpointStore.createRedoCheckpointFromSources(sourceCheckpointIds)
}

export async function restoreWorkspaceCheckpointSequence(checkpointIds: string[]) {
  const workspaceCheckpointStore = await getDefaultWorkspaceCheckpointStore()
  const workspaceRootPath = await workspaceCheckpointStore.restoreCheckpointSequence(checkpointIds)
  void import('./explorerWatch')
    .then(({ notifyWorkspaceExplorerChange }) => {
      notifyWorkspaceExplorerChange(workspaceRootPath)
    })
    .catch(() => {
      // Node-only tests import checkpoint helpers without the Electron runtime.
    })
}

interface WorkspaceEntries {
  directoryPaths: string[]
  filePaths: string[]
}

async function collectWorkspaceEntries(workspaceRootPath: string): Promise<WorkspaceEntries> {
  const filePaths: string[] = []
  const directoryPaths: string[] = []

  async function walkDirectory(currentDirectoryPath: string) {
    let entries
    try {
      entries = await fs.readdir(currentDirectoryPath, { withFileTypes: true })
    } catch {
      return
    }

    const matcherEntries = await loadGitignoreMatchers(workspaceRootPath, currentDirectoryPath)

    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue
      }
      if (shouldIgnoreWorkspaceEntry(entry.name)) {
        continue
      }

      const absolutePath = path.join(currentDirectoryPath, entry.name)
      if (isGitignored(absolutePath, entry.isDirectory(), matcherEntries)) {
        continue
      }

      if (entry.isDirectory()) {
        directoryPaths.push(absolutePath)
        await walkDirectory(absolutePath)
      } else if (entry.isFile()) {
        filePaths.push(absolutePath)
      }
    }
  }

  await walkDirectory(workspaceRootPath)
  return { directoryPaths, filePaths }
}

export async function captureWorkspaceCheckpointTerminalPreState(
  checkpointId: string | null | undefined,
  workspaceRootPath: string,
  customStore?: WorkspaceCheckpointStore,
) {
  const normalizedCheckpointId = checkpointId?.trim()
  if (!normalizedCheckpointId) {
    return
  }

  const { filePaths, directoryPaths } = await collectWorkspaceEntries(workspaceRootPath)
  const checkpointStore = customStore ?? (await getDefaultWorkspaceCheckpointStore())

  // Snapshot existing file contents so we can restore modified files on revert.
  for (const absolutePath of filePaths) {
    await checkpointStore.captureFileState(normalizedCheckpointId, absolutePath)
  }

  // Save the list of directories that exist NOW (before the terminal runs).
  // This lets post-state detect which directories were created by the terminal.
  await checkpointStore.savePreStateDirectories(normalizedCheckpointId, directoryPaths)
}

export async function captureWorkspaceCheckpointTerminalPostState(
  checkpointId: string | null | undefined,
  _workspaceRootPath: string,
  customStore?: WorkspaceCheckpointStore,
) {
  const normalizedCheckpointId = checkpointId?.trim()
  if (!normalizedCheckpointId) {
    return
  }

  const checkpointStore = customStore ?? (await getDefaultWorkspaceCheckpointStore())

  // Prune any pre-state entries for files that were NOT modified by the terminal command.
  // This ensures that user manual edits to unrelated files are NEVER undone when reverting the chat,
  // and user-created files (like test.md) are NEVER registered for deletion on revert.
  await checkpointStore.pruneUnchangedEntries(normalizedCheckpointId)
}
