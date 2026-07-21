import { webContents, type WebContents } from 'electron'
import { readdir } from 'node:fs/promises'
import chokidar, { type FSWatcher } from 'chokidar'
import path from 'node:path'
import { isWorkspaceExplorerTemporaryDeletingEntryName } from './explorerIgnore'
import { WorkspaceExplorerWatchSubscriptions } from './explorerWatchSubscriptions'

const DEFAULT_RELATIVE_PATH = '.'
const IGNORED_DIRECTORY_NAMES = new Set([
  '.git',
  'node_modules',
  '.next',
  '.nuxt',
  '__pycache__',
  '.cache',
  '.turbo',
  '.svelte-kit',
  '.angular',
  '.output',
  'venv',
  '.venv',
  '.tox',
])
const IGNORED_FILE_NAMES = new Set<string>()
const RELOAD_DEBOUNCE_MS = 100
const POLL_INTERVAL_MS = 1000
const SNAPSHOT_ERROR = '__workspace_snapshot_error__'

interface WorkspaceExplorerWatcherState {
  watcher: FSWatcher | null
  pollTimerId: ReturnType<typeof setInterval> | null
  pendingEmitTimerId: ReturnType<typeof setTimeout> | null
  lastSnapshot: string | null
  subscribers: Set<number>
}

const watcherStates = new Map<string, WorkspaceExplorerWatcherState>()
const subscriptions = new WorkspaceExplorerWatchSubscriptions()
const registeredSenders = new Set<number>()

function normalizeWorkspaceRootPath(workspaceRootPath: string) {
  return path.resolve(workspaceRootPath.trim())
}

function shouldIncludeEntry(entryName: string, isDirectory: boolean) {
  if (isWorkspaceExplorerTemporaryDeletingEntryName(entryName)) {
    return false
  }

  if (isDirectory) {
    return !IGNORED_DIRECTORY_NAMES.has(entryName)
  }

  return !IGNORED_FILE_NAMES.has(entryName)
}

async function buildWorkspaceTreeSnapshot(rootPath: string): Promise<string> {
  const normalizedRootPath = normalizeWorkspaceRootPath(rootPath)
  const snapshotEntries: string[] = []

  async function visitDirectory(relativePath: string): Promise<void> {
    const absolutePath =
      relativePath === DEFAULT_RELATIVE_PATH ? normalizedRootPath : path.resolve(normalizedRootPath, relativePath)
    const directoryEntries = await readdir(absolutePath, { withFileTypes: true })

    for (const directoryEntry of directoryEntries) {
      if (directoryEntry.isSymbolicLink()) {
        continue
      }

      const isDirectory = directoryEntry.isDirectory()
      if (!isDirectory && !directoryEntry.isFile()) {
        continue
      }
      if (!shouldIncludeEntry(directoryEntry.name, isDirectory)) {
        continue
      }

      const nextRelativePath =
        relativePath === DEFAULT_RELATIVE_PATH
          ? directoryEntry.name
          : path.join(relativePath, directoryEntry.name)
      snapshotEntries.push(`${isDirectory ? 'd' : 'f'}:${nextRelativePath}`)

      if (isDirectory) {
        await visitDirectory(nextRelativePath)
      }
    }
  }

  await visitDirectory(DEFAULT_RELATIVE_PATH)
  snapshotEntries.sort((left, right) => left.localeCompare(right))
  return snapshotEntries.join('\n')
}

function removeWorkspaceExplorerWatcherState(rootPath: string) {
  const normalizedRootPath = normalizeWorkspaceRootPath(rootPath)
  const state = watcherStates.get(normalizedRootPath)
  if (!state) {
    return
  }

  if (state.pendingEmitTimerId !== null) {
    clearTimeout(state.pendingEmitTimerId)
    state.pendingEmitTimerId = null
  }
  if (state.pollTimerId !== null) {
    clearInterval(state.pollTimerId)
    state.pollTimerId = null
  }

  if (state.watcher) {
    void state.watcher.close()
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

  for (const subscriberId of Array.from(state.subscribers)) {
    const targetWebContents = webContents.fromId(subscriberId)
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
    const nextSnapshot = await buildWorkspaceTreeSnapshot(normalizedRootPath)
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
  void refreshWorkspaceExplorerSnapshot(rootPath)
  state.pollTimerId = setInterval(() => {
    void refreshWorkspaceExplorerSnapshot(rootPath)
  }, POLL_INTERVAL_MS)
}

function startWatchingWorkspaceRoot(rootPath: string, state: WorkspaceExplorerWatcherState) {
  try {
    state.watcher = chokidar.watch(rootPath, {
      ignoreInitial: true,
      ignored: (testPath: string) => {
        const basename = path.basename(testPath)
        return (
          IGNORED_DIRECTORY_NAMES.has(basename) ||
          IGNORED_FILE_NAMES.has(basename) ||
          isWorkspaceExplorerTemporaryDeletingEntryName(basename)
        )
      },
    })
    state.watcher.on('all', () => {
      scheduleWorkspaceExplorerChange(rootPath)
    })
    state.watcher.on('ready', () => {
      scheduleWorkspaceExplorerChange(rootPath)
    })
    state.watcher.on('error', () => {
      if (state.watcher) {
        void state.watcher.close()
        state.watcher = null
      }
      if (state.pollTimerId === null) {
        startPollingWorkspaceRoot(rootPath, state)
      }
    })
    return
  } catch {
    // Fall back to polling when recursive watching is unavailable.
  }

  startPollingWorkspaceRoot(rootPath, state)
}

function getWorkspaceExplorerWatcherState(rootPath: string) {
  const normalizedRootPath = normalizeWorkspaceRootPath(rootPath)
  const existingState = watcherStates.get(normalizedRootPath)
  if (existingState) {
    return existingState
  }

  const nextState: WorkspaceExplorerWatcherState = {
    watcher: null,
    pollTimerId: null,
    pendingEmitTimerId: null,
    lastSnapshot: null,
    subscribers: new Set(),
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
  }
}

function addWorkspaceExplorerSubscriber(sender: WebContents, workspaceRootPath: string) {
  const normalizedRootPath = normalizeWorkspaceRootPath(workspaceRootPath)
  const state = getWorkspaceExplorerWatcherState(normalizedRootPath)
  if (subscriptions.subscribe(sender.id, normalizedRootPath)) {
    state.subscribers.add(sender.id)
  }

  if (!registeredSenders.has(sender.id)) {
    registeredSenders.add(sender.id)
    sender.once('destroyed', () => {
      removeWorkspaceExplorerSubscriber(sender.id)
      registeredSenders.delete(sender.id)
    })
  }
}

export function subscribeWorkspaceExplorerChanges(sender: WebContents, workspaceRootPath: string) {
  addWorkspaceExplorerSubscriber(sender, workspaceRootPath)
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
