import type { WebContents } from 'electron'
import * as electronModule from 'electron'
import chokidar, { type FSWatcher } from 'chokidar'
import path from 'node:path'
import { resolveRepositoryRoot } from './repositoryContext'
import { SourceControlWatchSubscriptions } from './sourceControlWatchSubscriptions'
import { shouldIgnoreGitSourceControlWatchPath } from './sourceControlWatchFilter'

const SOURCE_CONTROL_CHANGE_DEBOUNCE_MS = 120

interface SourceControlWatcherState {
  pendingEmitTimerId: ReturnType<typeof setTimeout> | null
  startPromise: Promise<void> | null
  subscribers: Set<number>
  watcher: FSWatcher | null
  watcherGeneration: number
}

const watcherStates = new Map<string, SourceControlWatcherState>()
const subscriptions = new SourceControlWatchSubscriptions()
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

function normalizeWorkspacePath(workspacePath: string) {
  if (typeof workspacePath !== 'string') {
    throw new Error('Workspace path is required.')
  }

  const trimmedWorkspacePath = workspacePath.trim()
  if (trimmedWorkspacePath.length === 0) {
    throw new Error('Workspace path is required.')
  }

  return path.resolve(trimmedWorkspacePath)
}

async function getWatchTargets(workspacePath: string) {
  const repositoryRootPath = await resolveRepositoryRoot(workspacePath).catch(() => null)
  return Array.from(new Set([workspacePath, repositoryRootPath].filter((value): value is string => Boolean(value))))
}

function getWatcherState(workspacePath: string) {
  const existingState = watcherStates.get(workspacePath)
  if (existingState) {
    return existingState
  }

  const nextState: SourceControlWatcherState = {
    pendingEmitTimerId: null,
    startPromise: null,
    subscribers: new Set(),
    watcher: null,
    watcherGeneration: 0,
  }
  watcherStates.set(workspacePath, nextState)
  return nextState
}

function removeWatcherState(workspacePath: string) {
  const state = watcherStates.get(workspacePath)
  if (!state) {
    return
  }

  state.watcherGeneration += 1
  if (state.pendingEmitTimerId !== null) {
    clearTimeout(state.pendingEmitTimerId)
    state.pendingEmitTimerId = null
  }

  const watcher = state.watcher
  state.watcher = null
  state.startPromise = null
  state.subscribers.clear()
  watcherStates.delete(workspacePath)

  if (watcher) {
    void watcher.close().catch(() => undefined)
  }
}

function scheduleSourceControlChange(workspacePath: string) {
  const state = watcherStates.get(workspacePath)
  if (!state || state.pendingEmitTimerId !== null) {
    return
  }

  state.pendingEmitTimerId = setTimeout(() => {
    state.pendingEmitTimerId = null
    emitSourceControlChange(workspacePath)
  }, SOURCE_CONTROL_CHANGE_DEBOUNCE_MS)
}

function emitSourceControlChange(workspacePath: string) {
  const state = watcherStates.get(workspacePath)
  if (!state) {
    return
  }

  const webContentsRegistry = resolveElectronWebContentsRegistry()
  for (const subscriberId of Array.from(state.subscribers)) {
    const targetWebContents = webContentsRegistry?.fromId(subscriberId)
    if (!targetWebContents || targetWebContents.isDestroyed()) {
      removeSourceControlSubscriber(subscriberId)
      continue
    }

    targetWebContents.send('git:sourceControl:changed', {
      workspacePath,
    })
  }

  if (state.subscribers.size === 0) {
    removeWatcherState(workspacePath)
  }
}

function startWatcher(workspacePath: string, state: SourceControlWatcherState, watchTargets: readonly string[]) {
  const watcherGeneration = state.watcherGeneration
  const watcher = chokidar.watch([...watchTargets], {
    followSymlinks: false,
    ignoreInitial: true,
    ignorePermissionErrors: true,
    ignored: (candidatePath: string) => {
      const containingWatchTarget = watchTargets.find((watchTarget) => {
        const relativePath = path.relative(watchTarget, candidatePath)
        return (
          relativePath.length === 0 ||
          (!relativePath.startsWith('..' + path.sep) && !path.isAbsolute(relativePath))
        )
      })

      return containingWatchTarget
        ? shouldIgnoreGitSourceControlWatchPath(containingWatchTarget, candidatePath)
        : true
    },
    persistent: true,
  })

  state.watcher = watcher
  watcher.on('all', () => {
    if (state.watcher !== watcher || state.watcherGeneration !== watcherGeneration) {
      return
    }

    scheduleSourceControlChange(workspacePath)
  })
  watcher.on('error', (error: unknown) => {
    if (state.watcher !== watcher || state.watcherGeneration !== watcherGeneration) {
      return
    }

    console.error('Git source-control watcher reported an error', error)
    scheduleSourceControlChange(workspacePath)
  })
}

function ensureWatcher(workspacePath: string, state: SourceControlWatcherState) {
  if (state.watcher) {
    return Promise.resolve()
  }

  if (state.startPromise) {
    return state.startPromise
  }

  const watcherGeneration = state.watcherGeneration
  state.startPromise = getWatchTargets(workspacePath)
    .then((watchTargets) => {
      if (watcherStates.get(workspacePath) !== state || state.watcherGeneration !== watcherGeneration) {
        return
      }

      startWatcher(workspacePath, state, watchTargets)
    })
    .catch((error: unknown) => {
      if (watcherStates.get(workspacePath) === state && state.watcherGeneration === watcherGeneration) {
        console.error('Failed to start the Git source-control watcher', error)
      }
    })
    .finally(() => {
      if (watcherStates.get(workspacePath) === state) {
        state.startPromise = null
      }
    })

  return state.startPromise
}

function removeSourceControlSubscriber(senderId: number, workspacePath?: string) {
  const subscribedWorkspacePaths = workspacePath
    ? [normalizeWorkspacePath(workspacePath)]
    : subscriptions.removeSubscriber(senderId)

  for (const subscribedWorkspacePath of subscribedWorkspacePaths) {
    if (workspacePath && !subscriptions.unsubscribe(senderId, subscribedWorkspacePath)) {
      continue
    }

    const state = watcherStates.get(subscribedWorkspacePath)
    if (!state) {
      continue
    }

    state.subscribers.delete(senderId)
    if (state.subscribers.size === 0) {
      removeWatcherState(subscribedWorkspacePath)
    }
  }
}

export async function subscribeSourceControlChanges(sender: WebContents, workspacePath: string) {
  const normalizedWorkspacePath = normalizeWorkspacePath(workspacePath)
  const state = getWatcherState(normalizedWorkspacePath)
  state.subscribers.add(sender.id)
  subscriptions.subscribe(sender.id, normalizedWorkspacePath)

  if (!registeredSenders.has(sender.id)) {
    registeredSenders.add(sender.id)
    sender.once('destroyed', () => {
      removeSourceControlSubscriber(sender.id)
      registeredSenders.delete(sender.id)
    })
  }

  await ensureWatcher(normalizedWorkspacePath, state)
}

export function unsubscribeSourceControlChanges(senderId: number, workspacePath: string) {
  removeSourceControlSubscriber(senderId, workspacePath)
}

export function notifySourceControlChange(workspacePath: string) {
  let normalizedWorkspacePath: string
  try {
    normalizedWorkspacePath = normalizeWorkspacePath(workspacePath)
  } catch {
    return
  }

  if (!watcherStates.has(normalizedWorkspacePath)) {
    return
  }

  scheduleSourceControlChange(normalizedWorkspacePath)
}

export function disposeSourceControlWatchers() {
  for (const workspacePath of Array.from(watcherStates.keys())) {
    removeWatcherState(workspacePath)
  }
  subscriptions.clear()
  registeredSenders.clear()
}
