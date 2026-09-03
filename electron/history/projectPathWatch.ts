import chokidar, { type FSWatcher } from 'chokidar'
import path from 'node:path'
import type { ConversationFolderRecord, ProjectFolderPrunedEvent } from '../../src/types/chat'
import { filterResolvableFolderRecords } from './folderPathPruning'
import { readFolderStore } from './folderStore'
import { deleteStoredFolder } from './store'

const PROJECT_PATH_CHECK_DEBOUNCE_MS = 100
const PROJECT_PATH_INITIAL_CHECK_DELAY_MS = 10_000
const PROJECT_PATH_POLL_INTERVAL_MS = 30_000

interface ProjectPathWatchState {
  checkInFlight: boolean
  checkRequested: boolean
  onPruned: (event: ProjectFolderPrunedEvent) => void
  pendingCheckTimerId: ReturnType<typeof setTimeout> | null
  pollTimerId: ReturnType<typeof setInterval> | null
  trackedFolders: Map<string, ConversationFolderRecord>
  watcher: FSWatcher | null
  watcherGeneration: number
  watchAllowedPaths: Set<string>
  watchTargets: Set<string>
}

let watchState: ProjectPathWatchState | null = null

function setsMatch(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  if (left.size !== right.size) {
    return false
  }

  for (const value of left) {
    if (!right.has(value)) {
      return false
    }
  }

  return true
}

function resolveProjectPathWatchTargets(folders: Iterable<ConversationFolderRecord>) {
  return new Set(Array.from(folders, (folder) => path.dirname(path.resolve(folder.path))))
}

function normalizeProjectPathWatchPath(candidatePath: string) {
  const resolvedPath = path.resolve(candidatePath)
  return process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath
}

export function shouldIgnoreProjectPathWatchEntry(candidatePath: string, allowedPaths: ReadonlySet<string>) {
  return !allowedPaths.has(normalizeProjectPathWatchPath(candidatePath))
}

function restartProjectDirectoryWatcher(state: ProjectPathWatchState) {
  const nextTargets = resolveProjectPathWatchTargets(state.trackedFolders.values())
  const nextAllowedPaths = new Set<string>()
  for (const target of nextTargets) {
    nextAllowedPaths.add(normalizeProjectPathWatchPath(target))
  }
  for (const folder of state.trackedFolders.values()) {
    nextAllowedPaths.add(normalizeProjectPathWatchPath(folder.path))
  }
  if (setsMatch(state.watchTargets, nextTargets) && setsMatch(state.watchAllowedPaths, nextAllowedPaths)) {
    return
  }

  state.watchTargets = nextTargets
  state.watchAllowedPaths = nextAllowedPaths
  state.watcherGeneration += 1
  const watcherGeneration = state.watcherGeneration
  const previousWatcher = state.watcher
  state.watcher = null
  if (previousWatcher) {
    void previousWatcher.close().catch(() => undefined)
  }

  if (nextTargets.size === 0) {
    return
  }

  const watcher = chokidar.watch(Array.from(nextTargets), {
    depth: 0,
    ignored: (candidatePath) => shouldIgnoreProjectPathWatchEntry(candidatePath, nextAllowedPaths),
    ignoreInitial: true,
  })
  state.watcher = watcher

  watcher.on('all', () => {
    if (watchState !== state || state.watcher !== watcher || state.watcherGeneration !== watcherGeneration) {
      return
    }
    scheduleProjectPathCheck(state)
  })
  watcher.on('error', (error: unknown) => {
    if (watchState !== state || state.watcher !== watcher || state.watcherGeneration !== watcherGeneration) {
      return
    }

    console.error('Project path watcher reported an error; polling remains active.', error)
    state.watcher = null
    state.watchAllowedPaths = new Set()
    state.watchTargets = new Set()
    void watcher.close().catch(() => undefined)
  })
}

function replaceTrackedFolders(state: ProjectPathWatchState, folders: ConversationFolderRecord[]) {
  state.trackedFolders = new Map(folders.map((folder) => [folder.id, folder]))
  restartProjectDirectoryWatcher(state)
}

async function reconcileProjectPaths(state: ProjectPathWatchState) {
  if (watchState !== state) {
    return
  }
  if (state.checkInFlight) {
    state.checkRequested = true
    return
  }

  state.checkInFlight = true
  try {
    const persistedFolders = await readFolderStore()
    const foldersToCheck = new Map(state.trackedFolders)
    for (const folder of persistedFolders) {
      foldersToCheck.set(folder.id, folder)
    }

    const candidates = Array.from(foldersToCheck.values())
    const resolvableFolders = await filterResolvableFolderRecords(candidates)
    const resolvableFolderIds = new Set(resolvableFolders.map((folder) => folder.id))
    const missingFolders = candidates.filter((folder) => !resolvableFolderIds.has(folder.id))

    for (const folder of missingFolders) {
      const deletedConversationIds = await deleteStoredFolder(folder.id)
      if (watchState !== state) {
        return
      }
      state.trackedFolders.delete(folder.id)
      state.onPruned({
        deletedConversationIds,
        folderId: folder.id,
      })
    }

    replaceTrackedFolders(state, await readFolderStore())
  } catch (error) {
    console.error('Failed to reconcile saved Project paths.', error)
  } finally {
    state.checkInFlight = false
    if (watchState === state && state.checkRequested) {
      state.checkRequested = false
      scheduleProjectPathCheck(state, 0)
    }
  }
}

function scheduleProjectPathCheck(state: ProjectPathWatchState, delayMs = PROJECT_PATH_CHECK_DEBOUNCE_MS) {
  if (watchState !== state || state.pendingCheckTimerId !== null) {
    return
  }

  state.pendingCheckTimerId = setTimeout(() => {
    state.pendingCheckTimerId = null
    void reconcileProjectPaths(state)
  }, delayMs)
}

export async function startProjectPathWatcher(onPruned: (event: ProjectFolderPrunedEvent) => void) {
  disposeProjectPathWatcher()

  const state: ProjectPathWatchState = {
    checkInFlight: false,
    checkRequested: false,
    onPruned,
    pendingCheckTimerId: null,
    pollTimerId: null,
    trackedFolders: new Map(),
    watcher: null,
    watcherGeneration: 0,
    watchAllowedPaths: new Set(),
    watchTargets: new Set(),
  }
  watchState = state

  replaceTrackedFolders(state, await readFolderStore())
  if (watchState !== state) {
    return
  }

  scheduleProjectPathCheck(state, PROJECT_PATH_INITIAL_CHECK_DELAY_MS)
  state.pollTimerId = setInterval(() => {
    scheduleProjectPathCheck(state, 0)
  }, PROJECT_PATH_POLL_INTERVAL_MS)
}

export function refreshProjectPathWatcher() {
  const state = watchState
  if (!state) {
    return
  }
  scheduleProjectPathCheck(state, 0)
}

export function disposeProjectPathWatcher() {
  const state = watchState
  watchState = null
  if (!state) {
    return
  }

  state.watcherGeneration += 1
  if (state.pendingCheckTimerId !== null) {
    clearTimeout(state.pendingCheckTimerId)
  }
  if (state.pollTimerId !== null) {
    clearInterval(state.pollTimerId)
  }
  if (state.watcher) {
    void state.watcher.close().catch(() => undefined)
  }
}
