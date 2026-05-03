import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { CreateWorkspaceCheckpointInput, UserMessageRunCheckpoint } from '../../src/types/chat'

interface WorkspaceCheckpointEntry {
  existed: boolean
  missingDirectories?: string[]
  relativePath: string
  snapshotFileName?: string
}

interface WorkspaceCheckpointDocument {
  createdAt: number
  entries: WorkspaceCheckpointEntry[]
  id: string
  workspaceRootPath: string
}

interface WorkspaceCheckpointStore {
  captureFileState: (checkpointId: string, absolutePath: string) => Promise<void>
  createCheckpoint: (input: CreateWorkspaceCheckpointInput) => Promise<UserMessageRunCheckpoint>
  createRedoCheckpointFromSource: (sourceCheckpointId: string) => Promise<UserMessageRunCheckpoint>
  createRedoCheckpointFromSources: (sourceCheckpointIds: string[]) => Promise<UserMessageRunCheckpoint>
  restoreCheckpoint: (checkpointId: string) => Promise<string>
  restoreCheckpointSequence: (checkpointIds: string[]) => Promise<string>
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

function assertInsideWorkspace(workspaceRootPath: string, absolutePath: string) {
  const relativePath = path.relative(workspaceRootPath, absolutePath)
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Path is outside the workspace checkpoint root: ${absolutePath}`)
  }

  return relativePath
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
        const relativePath = assertInsideWorkspace(manifest.workspaceRootPath, normalizedTargetPath)
        const normalizedRelativePath = normalizeRelativePath(relativePath)
        if (manifest.entries.some((entry) => normalizeRelativePath(entry.relativePath) === normalizedRelativePath)) {
          return
        }

        try {
          const targetStats = await fs.stat(normalizedTargetPath)
          if (!targetStats.isFile()) {
            throw new Error(`Checkpoint capture only supports files: ${normalizedTargetPath}`)
          }

          const snapshotFileName = `${manifest.entries.length}.txt`
          await ensureDirectory(getCheckpointSnapshotsDirectoryPath(checkpointId))
          await fs.writeFile(
            path.join(getCheckpointSnapshotsDirectoryPath(checkpointId), snapshotFileName),
            await fs.readFile(normalizedTargetPath, 'utf8'),
            'utf8',
          )
          manifest.entries.push({
            existed: true,
            relativePath,
            snapshotFileName,
          })
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

    async restoreCheckpoint(checkpointId: string) {
      return withCheckpointLock(checkpointId, async () => {
        const manifest = await readManifest(checkpointId)
        const restoreEntries = [...manifest.entries].reverse()
        const directoryCleanupCandidates = new Set<string>()

        for (const entry of restoreEntries) {
          const absolutePath = path.join(manifest.workspaceRootPath, entry.relativePath)

          if (!entry.existed) {
            await fs.rm(absolutePath, { force: true, recursive: true }).catch((error: unknown) => {
              if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw error
              }
            })

            for (const missingDirectory of entry.missingDirectories ?? []) {
              directoryCleanupCandidates.add(missingDirectory)
            }
            continue
          }

          if (!entry.snapshotFileName) {
            throw new Error(`Checkpoint snapshot is missing for ${entry.relativePath}`)
          }

          const snapshotPath = path.join(getCheckpointSnapshotsDirectoryPath(checkpointId), entry.snapshotFileName)
          const snapshotContent = await fs.readFile(snapshotPath, 'utf8')
          const existingStats = await fs.stat(absolutePath).catch((error: unknown) => {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
              return null
            }

            throw error
          })

          if (existingStats?.isDirectory()) {
            await fs.rm(absolutePath, { force: true, recursive: true })
          }

          await ensureDirectory(path.dirname(absolutePath))
          await fs.writeFile(absolutePath, snapshotContent, 'utf8')
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
