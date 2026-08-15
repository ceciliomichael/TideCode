import type { WebContents } from 'electron'
import * as electronModule from 'electron'
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import {
  IGNORED_DIRECTORY_NAMES,
  shouldIncludeWorkspaceWatchSnapshotEntry,
} from './explorerWatchFilter'
import {
  createWorkspaceDirectoryWatcher,
  type WorkspaceDirectoryWatcher,
} from './explorerDirectoryWatcher'
import { WorkspaceExplorerWatchSubscriptions } from './explorerWatchSubscriptions'

const DEFAULT_RELATIVE_PATH = '.'
const RELOAD_DEBOUNCE_MS = 100
const POLL_INTERVAL_MS = 1500
const SNAPSHOT_ERROR = '__workspace_snapshot_error__'

interface WorkspaceExplorerWatcherState {
  watcher: WorkspaceDirectoryWatcher | null
  watcherGeneration: number
  pollTimerId: ReturnType<typeof setInterval> | null
  pendingEmitTimerId: ReturnType<typeof setTimeout> | null
  lastSnapshot: string | null
  subscribers: Set<number>
  watchedRelativeDirectoryPaths: Set<string>
}

const watcherStates = new Map<string, WorkspaceExplorerWatcherState>()
const subscriptions = new WorkspaceExplorerWatchSubscriptions()
const registeredSenders = new Set<number>()

interface ElectronWebContentsRegistry {
  fromId(id: number): WebContents | undefined
}

function resolveElectronWebContentsRegistry(): ElectronWebContentsRegistry | null {
  const electronNamespace = electronModule as unknown as {
    default?: unknown
    webContents?: unknown
  }
  const defaultExport =
    typeof electronNamespace.default === 'object' && electronNamespace.default !== null
      ? electronNamespace.default as { webContents?: unknown }
      : null
  const candidate = electronNamespace.webContents ?? defaultExport?.webContents

  return typeof candidate === 'object' && candidate !== null &&
    typeof (candidate as ElectronWebContentsRegistry).fromId === 'function'
    ? candidate as ElectronWebContentsRegistry
    : null
}

function normalizeWorkspaceRootPath(workspaceRootPath: string) {
  return path.resolve(workspaceRootPath.trim())
}

function normalizeRelativeDirectoryPaths(rootPath: string, relativeDirectoryPaths?: readonly string[]) {
  const normalizedRootPath = normalizeWorkspaceRootPath(rootPath)
  const candidates = relativeDirectoryPaths && relativeDirectoryPaths.length > 0 ? relativeDirectoryPaths : [DEFAULT_RELATIVE_PATH]
  const normalizedPaths = new Set<string>()

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') {
      continue
    }

    const absolutePath = path.resolve(normalizedRootPath, candidate.trim() || DEFAULT_RELATIVE_PATH)
    const relativePath = path.relative(normalizedRootPath, absolutePath)
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      continue
    }

    const segments = relativePath.split(path.sep).filter((segment) => segment.length > 0)
    if (segments.some((segment) => IGNORED_DIRECTORY_NAMES.has(segment))) {
      continue
    }

    normalizedPaths.add(relativePath.length === 0 ? DEFAULT_RELATIVE_PATH : relativePath)
  }

  return normalizedPaths.size > 0 ? normalizedPaths : new Set([DEFAULT_RELATIVE_PATH])
}

async function buildWatchedDirectoriesSnapshot(
  rootPath: string,
  watchedRelativeDirectoryPaths: ReadonlySet<string>,
): Promise<string> {
  const normalizedRootPath = normalizeWorkspaceRootPath(rootPath)
  const snapshotEntries: string[] = []

  await Promise.all(
    Array.from(watchedRelativeDirectoryPaths, async (relativePath) => {
      const absolutePath =
        relativePath === DEFAULT_RELATIVE_PATH ? normalizedRootPath : path.resolve(normalizedRootPath, relativePath)
      const directoryEntries = await readdir(absolutePath, { withFileTypes: true }).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return []
        }
        throw error
      })

      const fileEntries = directoryEntries.filter(
        (entry) => entry.isFile() && shouldIncludeWorkspaceWatchSnapshotEntry(entry.name, false),
      )
      const fileStats = await Promise.all(
        fileEntries.map(async (entry) => {
          const filePath = path.join(absolutePath, entry.name)
          const fileStat = await stat(filePath).catch(() => null)
          return `${relativePath === DEFAULT_RELATIVE_PATH ? entry.name : path.join(relativePath, entry.name)}:${
            fileStat?.mtimeMs ?? 0
          }:${fileStat?.size ?? 0}`
        }),
      )

      for (const directoryEntry of directoryEntries) {
        if (directoryEntry.isSymbolicLink()) {
          continue
        }

        const isDirectory = directoryEntry.isDirectory()
        if (
          (!isDirectory && !directoryEntry.isFile()) ||
          !shouldIncludeWorkspaceWatchSnapshotEntry(directoryEntry.name, isDirectory)
        ) {
          continue
        }

        const nextRelativePath =
          relativePath === DEFAULT_RELATIVE_PATH
            ? directoryEntry.name
            : path.join(relativePath, directoryEntry.name)
        snapshotEntries.push(`${isDirectory ? 'd' : 'f'}:${nextRelativePath}`)
      }

      snapshotEntries.push(...fileStats.map((fileStat) => `m:${fileStat}`))
    }),
  )

  snapshotEntries.sort((left, right) => left.localeCompare(right))
  return snapshotEntries.join('\n')
}

function removeWorkspaceExplorerWatcherState(rootPath: string) {
  const normalizedRootPath = normalizeWorkspaceRootPath(rootPath)
  const state = watcherStates.get(normalizedRootPath)
  if (!state) {
    return
  }

  state.watcherGeneration += 1
  if (state.pendingEmitTimerId !== null) {
    clearTimeout(state.pendingEmitTimerId)
    state.pendingEmitTimerId = null
  }
  if (state.pollTimerId !== null) {
    clearInterval(state.pollTimerId)
    state.pollTimerId = null
  }

  if (state.watcher) {
    void state.watcher.close().catch(() => undefined)
  }
  state.watcher = null
  state.subscribers.clear()
  watcherStates.delete(normalizedRootPath)
}

function scheduleWorkspaceExplorerChange(rootPath: string) {
  const normalizedRootPath = normalizeWorkspaceRootPath(rootPath)
  const state = watcherStates.get(normalizedRootPath)
  if (!state || state.pendingEmitTimerId !== null) {
    return
  }

  state.pendingEmitTimerId = setTimeout(() => {
    state.pendingEmitTimerId = null
    emitWorkspaceExplorerChange(normalizedRootPath)
  }, RELOAD_DEBOUNCE_MS)
}

function emitWorkspaceExplorerChange(rootPath: string) {
  const normalizedRootPath = normalizeWorkspaceRootPath(rootPath)
  const state = watcherStates.get(normalizedRootPath)
  if (!state) {
    return
  }
  const webContentsRegistry = resolveElectronWebContentsRegistry()

  for (const subscriberId of Array.from(state.subscribers)) {
    const targetWebContents = webContentsRegistry?.fromId(subscriberId)
    if (!targetWebContents || targetWebContents.isDestroyed()) {
      state.subscribers.delete(subscriberId)
      removeWorkspaceExplorerSubscriber(subscriberId)
      continue
    }

    targetWebContents.send('workspace:explorer:changed', {
      workspaceRootPath: normalizedRootPath,
    })
  }

  if (state.subscribers.size === 0) {
    removeWorkspaceExplorerWatcherState(normalizedRootPath)
  }
}

async function refreshWorkspaceExplorerSnapshot(rootPath: string) {
  const normalizedRootPath = normalizeWorkspaceRootPath(rootPath)
  const state = watcherStates.get(normalizedRootPath)
  if (!state) {
    return
  }

  try {
    const nextSnapshot = await buildWatchedDirectoriesSnapshot(
      normalizedRootPath,
      state.watchedRelativeDirectoryPaths,
    )
    if (state.lastSnapshot !== nextSnapshot) {
      state.lastSnapshot = nextSnapshot
      scheduleWorkspaceExplorerChange(normalizedRootPath)
    }
  } catch {
    if (state.lastSnapshot !== SNAPSHOT_ERROR) {
      state.lastSnapshot = SNAPSHOT_ERROR
      scheduleWorkspaceExplorerChange(normalizedRootPath)
    }
  }
}

function startPollingWorkspaceRoot(rootPath: string, state: WorkspaceExplorerWatcherState) {
  if (state.pollTimerId !== null) {
    return
  }

  void refreshWorkspaceExplorerSnapshot(rootPath)
  state.pollTimerId = setInterval(() => {
    void refreshWorkspaceExplorerSnapshot(rootPath)
  }, POLL_INTERVAL_MS)
}

function startDirectoryWatchingWorkspaceRoot(rootPath: string, state: WorkspaceExplorerWatcherState) {
  const watcherGeneration = state.watcherGeneration

  try {
    let watcher: WorkspaceDirectoryWatcher | null = null
    watcher = createWorkspaceDirectoryWatcher({
      rootPath,
      watchedRelativeDirectoryPaths: state.watchedRelativeDirectoryPaths,
      onChange: () => {
        if (state.watcher !== watcher || state.watcherGeneration !== watcherGeneration) {
          return
        }
        scheduleWorkspaceExplorerChange(rootPath)
      },
      onError: () => {
        if (state.watcher !== watcher || state.watcherGeneration !== watcherGeneration) {
          return
        }

        state.watcher = null
        void watcher?.close()
        startPollingWorkspaceRoot(rootPath, state)
      },
    })
    state.watcher = watcher
    return
  } catch {
    // Fall back to polling when directory watching is unavailable.
  }

  startPollingWorkspaceRoot(rootPath, state)
}

function startWatchingWorkspaceRoot(rootPath: string, state: WorkspaceExplorerWatcherState) {
  startDirectoryWatchingWorkspaceRoot(rootPath, state)
}

function restartWorkspaceExplorerWatcher(rootPath: string, state: WorkspaceExplorerWatcherState) {
  if (state.pollTimerId !== null) {
    state.lastSnapshot = null
    void refreshWorkspaceExplorerSnapshot(rootPath)
    return
  }

  state.watcherGeneration += 1
  const watcherGeneration = state.watcherGeneration
  const previousWatcher = state.watcher
  state.watcher = null

  void Promise.resolve(previousWatcher?.close())
    .catch(() => undefined)
    .finally(() => {
      if (watcherStates.get(rootPath) !== state || state.watcherGeneration !== watcherGeneration) {
        return
      }

      startWatchingWorkspaceRoot(rootPath, state)
    })
}

function getWorkspaceExplorerWatcherState(rootPath: string) {
  const normalizedRootPath = normalizeWorkspaceRootPath(rootPath)
  const existingState = watcherStates.get(normalizedRootPath)
  if (existingState) {
    return existingState
  }

  const nextState: WorkspaceExplorerWatcherState = {
    watcher: null,
    watcherGeneration: 0,
    pollTimerId: null,
    pendingEmitTimerId: null,
    lastSnapshot: null,
    subscribers: new Set(),
    watchedRelativeDirectoryPaths: new Set([DEFAULT_RELATIVE_PATH]),
  }

  watcherStates.set(normalizedRootPath, nextState)
  startWatchingWorkspaceRoot(normalizedRootPath, nextState)
  return nextState
}

function removeWorkspaceExplorerSubscriber(senderId: number, workspaceRootPath?: string) {
  if (!workspaceRootPath) {
    for (const rootPath of subscriptions.removeSubscriber(senderId)) {
      const state = watcherStates.get(rootPath)
      if (!state) {
        continue
      }

      state.subscribers.delete(senderId)
      if (state.subscribers.size === 0) {
        removeWorkspaceExplorerWatcherState(rootPath)
      } else {
        state.watchedRelativeDirectoryPaths = new Set(subscriptions.getWatchPaths(rootPath))
        restartWorkspaceExplorerWatcher(rootPath, state)
      }
    }
    return
  }

  const normalizedRootPath = normalizeWorkspaceRootPath(workspaceRootPath)
  if (!subscriptions.unsubscribe(senderId, normalizedRootPath)) {
    return
  }

  const state = watcherStates.get(normalizedRootPath)
  if (!state) {
    return
  }

  state.subscribers.delete(senderId)

  if (state.subscribers.size === 0) {
    removeWorkspaceExplorerWatcherState(normalizedRootPath)
  } else {
    state.watchedRelativeDirectoryPaths = new Set(subscriptions.getWatchPaths(normalizedRootPath))
    restartWorkspaceExplorerWatcher(normalizedRootPath, state)
  }
}

function addWorkspaceExplorerSubscriber(
  sender: WebContents,
  workspaceRootPath: string,
  relativeDirectoryPaths?: readonly string[],
) {
  const normalizedRootPath = normalizeWorkspaceRootPath(workspaceRootPath)
  const normalizedWatchPaths = normalizeRelativeDirectoryPaths(normalizedRootPath, relativeDirectoryPaths)
  const state = getWorkspaceExplorerWatcherState(normalizedRootPath)
  subscriptions.subscribe(sender.id, normalizedRootPath, normalizedWatchPaths)
  state.subscribers.add(sender.id)
  state.watchedRelativeDirectoryPaths = new Set(subscriptions.getWatchPaths(normalizedRootPath))
  restartWorkspaceExplorerWatcher(normalizedRootPath, state)

  if (!registeredSenders.has(sender.id)) {
    registeredSenders.add(sender.id)
    sender.once('destroyed', () => {
      removeWorkspaceExplorerSubscriber(sender.id)
      registeredSenders.delete(sender.id)
    })
  }
}

export function subscribeWorkspaceExplorerChanges(
  sender: WebContents,
  workspaceRootPath: string,
  relativeDirectoryPaths?: readonly string[],
) {
  addWorkspaceExplorerSubscriber(sender, workspaceRootPath, relativeDirectoryPaths)
}

export function updateWorkspaceExplorerWatchPaths(
  senderId: number,
  workspaceRootPath: string,
  relativeDirectoryPaths?: readonly string[],
) {
  const normalizedRootPath = normalizeWorkspaceRootPath(workspaceRootPath)
  const normalizedWatchPaths = normalizeRelativeDirectoryPaths(normalizedRootPath, relativeDirectoryPaths)
  if (!subscriptions.updateWatchPaths(senderId, normalizedRootPath, normalizedWatchPaths)) {
    return
  }

  const state = watcherStates.get(normalizedRootPath)
  if (!state) {
    return
  }

  state.watchedRelativeDirectoryPaths = new Set(subscriptions.getWatchPaths(normalizedRootPath))
  restartWorkspaceExplorerWatcher(normalizedRootPath, state)
}

export function unsubscribeWorkspaceExplorerChanges(senderId: number, workspaceRootPath?: string) {
  removeWorkspaceExplorerSubscriber(senderId, workspaceRootPath)
}

export function notifyWorkspaceExplorerChange(workspaceRootPath: string) {
  const normalizedRootPath = normalizeWorkspaceRootPath(workspaceRootPath)
  if (!watcherStates.has(normalizedRootPath)) {
    return
  }

  scheduleWorkspaceExplorerChange(normalizedRootPath)
}

export function disposeWorkspaceExplorerWatchers() {
  for (const rootPath of Array.from(watcherStates.keys())) {
    removeWorkspaceExplorerWatcherState(rootPath)
  }
  subscriptions.clear()
  registeredSenders.clear()
}
