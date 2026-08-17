import chokidar, { type FSWatcher } from 'chokidar'
import path from 'node:path'
import type { ConversationFolderRecord, ProjectFolderPrunedEvent } from '../../src/types/chat'
import { filterResolvableFolderRecords } from './folderPathPruning'
import { readFolderStore } from './folderStore'
import { deleteStoredFolder } from './store'

const PROJECT_PATH_CHECK_DEBOUNCE_MS = 100
const PROJECT_PATH_POLL_INTERVAL_MS = 1500

interface ProjectPathWatchState {
  checkInFlight: boolean
  checkRequested: boolean
  onPruned: (event: ProjectFolderPrunedEvent) => void
  pendingCheckTimerId: ReturnType<typeof setTimeout> | null
  pollTimerId: ReturnType<typeof setInterval> | null
  trackedFolders: Map<string, ConversationFolderRecord>
  watcher: FSWatcher | null
  watcherGeneration: number
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

function restartProjectDirectoryWatcher(state: ProjectPathWatchState) {
  const nextTargets = resolveProjectPathWatchTargets(state.trackedFolders.values())
  if (setsMatch(state.watchTargets, nextTargets)) {
    return
  }

  state.watchTargets = nextTargets
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
    watchTargets: new Set(),
  }
  watchState = state

  replaceTrackedFolders(state, await readFolderStore())
  await reconcileProjectPaths(state)
  if (watchState !== state) {
    return
  }

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
