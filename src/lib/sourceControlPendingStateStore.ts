import type { GitCommitAction, GitSyncAction } from '../types/chat'
import { normalizeGitWorkspacePath } from './gitBranchStateCache'

export type SourceControlPendingCommitAction = GitCommitAction
export type SourceControlPendingSyncAction = GitSyncAction | 'refresh'

export interface SourceControlPendingOperation<TAction extends string> {
  action: TAction
  sequence: number
  startedAt: number
}

export interface SourceControlWorkspacePendingState {
  commit: SourceControlPendingOperation<SourceControlPendingCommitAction> | null
  sync: SourceControlPendingOperation<SourceControlPendingSyncAction> | null
}

const STORAGE_KEY = 'echosphere:source-control-pending-state'
const PENDING_STATE_TTL_MS = 10 * 60 * 1000

let hasLoadedPersistedState = false
const pendingStateByWorkspace = new Map<string, SourceControlWorkspacePendingState>()
const listeners = new Set<() => void>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function cloneWorkspacePendingState(
  state: SourceControlWorkspacePendingState,
): SourceControlWorkspacePendingState {
  return {
    commit: state.commit ? { ...state.commit } : null,
    sync: state.sync ? { ...state.sync } : null,
  }
}

function getEmptyWorkspacePendingState(): SourceControlWorkspacePendingState {
  return {
    commit: null,
    sync: null,
  }
}

function readPersistedState(): Record<string, SourceControlWorkspacePendingState> {
  if (typeof window === 'undefined') {
    return {}
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return {}
    }

    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed)) {
      return {}
    }

    const nextState: Record<string, SourceControlWorkspacePendingState> = {}
    for (const [workspacePath, value] of Object.entries(parsed)) {
      if (!isRecord(value)) {
        continue
      }

      const commit = isRecord(value.commit)
        ? {
            action: value.commit.action,
            sequence: value.commit.sequence,
            startedAt: value.commit.startedAt,
          }
        : null
      const sync = isRecord(value.sync)
        ? {
            action: value.sync.action,
            sequence: value.sync.sequence,
            startedAt: value.sync.startedAt,
          }
        : null

      const normalizedWorkspacePath = normalizeGitWorkspacePath(workspacePath)
      if (!normalizedWorkspacePath) {
        continue
      }

      const normalizedCommit =
        commit &&
        typeof commit.action === 'string' &&
        typeof commit.sequence === 'number' &&
        typeof commit.startedAt === 'number'
          ? {
              action: commit.action as SourceControlPendingCommitAction,
              sequence: commit.sequence,
              startedAt: commit.startedAt,
            }
          : null
      const normalizedSync =
        sync && typeof sync.action === 'string' && typeof sync.sequence === 'number' && typeof sync.startedAt === 'number'
          ? {
              action: sync.action as SourceControlPendingSyncAction,
              sequence: sync.sequence,
              startedAt: sync.startedAt,
            }
          : null

      nextState[normalizedWorkspacePath] = {
        commit: normalizedCommit,
        sync: normalizedSync,
      }
    }

    return nextState
  } catch (error) {
    console.error('Failed to load source control pending state.', error)
    return {}
  }
}

function persistState() {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(pendingStateByWorkspace.entries())))
  } catch (error) {
    console.error('Failed to persist source control pending state.', error)
  }
}

function notifyListeners() {
  for (const listener of listeners) {
    listener()
  }
}

function ensureLoaded() {
  if (hasLoadedPersistedState) {
    return
  }

  hasLoadedPersistedState = true
  const persistedState = readPersistedState()
  for (const [workspacePath, workspaceState] of Object.entries(persistedState)) {
    pendingStateByWorkspace.set(workspacePath, cloneWorkspacePendingState(workspaceState))
  }
}

function isExpired(state: SourceControlPendingOperation<string>) {
  return Date.now() - state.startedAt > PENDING_STATE_TTL_MS
}

function pruneExpiredState(workspacePath: string, workspaceState: SourceControlWorkspacePendingState) {
  let nextState: SourceControlWorkspacePendingState | null = null

  if (workspaceState.commit && isExpired(workspaceState.commit)) {
    nextState ??= getEmptyWorkspacePendingState()
    nextState.commit = null
  }

  if (workspaceState.sync && isExpired(workspaceState.sync)) {
    nextState ??= getEmptyWorkspacePendingState()
    nextState.sync = null
  }

  if (!nextState) {
    return false
  }

  if (nextState.commit === null && nextState.sync === null) {
    pendingStateByWorkspace.delete(workspacePath)
  } else {
    pendingStateByWorkspace.set(workspacePath, nextState)
  }

  return true
}

function getWorkspacePendingState(workspacePath: string | null | undefined) {
  const normalizedWorkspacePath = normalizeGitWorkspacePath(workspacePath)
  if (!normalizedWorkspacePath) {
    return null
  }

  ensureLoaded()
  const workspaceState = pendingStateByWorkspace.get(normalizedWorkspacePath)
  if (!workspaceState) {
    return null
  }

  if (pruneExpiredState(normalizedWorkspacePath, workspaceState)) {
    persistState()
    notifyListeners()
    return pendingStateByWorkspace.get(normalizedWorkspacePath) ?? null
  }

  return workspaceState
}

function setWorkspacePendingState(workspacePath: string, workspaceState: SourceControlWorkspacePendingState) {
  pendingStateByWorkspace.set(workspacePath, workspaceState)
  persistState()
  notifyListeners()
}

function updateWorkspacePendingState(
  workspacePath: string | null | undefined,
  updater: (currentState: SourceControlWorkspacePendingState) => SourceControlWorkspacePendingState,
) {
  const normalizedWorkspacePath = normalizeGitWorkspacePath(workspacePath)
  if (!normalizedWorkspacePath) {
    return null
  }

  ensureLoaded()
  const currentState = pendingStateByWorkspace.get(normalizedWorkspacePath) ?? getEmptyWorkspacePendingState()
  const nextState = updater(cloneWorkspacePendingState(currentState))
  setWorkspacePendingState(normalizedWorkspacePath, nextState)
  return nextState
}

export function subscribeSourceControlPendingState(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getSourceControlPendingStateSnapshot(workspacePath: string | null | undefined) {
  return getWorkspacePendingState(workspacePath)
}

export function beginSourceControlCommitOperation(
  workspacePath: string | null | undefined,
  action: SourceControlPendingCommitAction,
): SourceControlPendingOperation<SourceControlPendingCommitAction> | null {
  const normalizedWorkspacePath = normalizeGitWorkspacePath(workspacePath)
  if (!normalizedWorkspacePath) {
    return null
  }

  return (
    updateWorkspacePendingState(normalizedWorkspacePath, (currentState) => {
      const nextSequence = (currentState.commit?.sequence ?? 0) + 1
      currentState.commit = {
        action,
        sequence: nextSequence,
        startedAt: Date.now(),
      }
      return currentState
    })?.commit ?? null
  )
}

export function beginSourceControlSyncOperation(
  workspacePath: string | null | undefined,
  action: SourceControlPendingSyncAction,
): SourceControlPendingOperation<SourceControlPendingSyncAction> | null {
  const normalizedWorkspacePath = normalizeGitWorkspacePath(workspacePath)
  if (!normalizedWorkspacePath) {
    return null
  }

  return (
    updateWorkspacePendingState(normalizedWorkspacePath, (currentState) => {
      const nextSequence = (currentState.sync?.sequence ?? 0) + 1
      currentState.sync = {
        action,
        sequence: nextSequence,
        startedAt: Date.now(),
      }
      return currentState
    })?.sync ?? null
  )
}

export function endSourceControlCommitOperation(
  workspacePath: string | null | undefined,
  sequence: number,
) {
  const normalizedWorkspacePath = normalizeGitWorkspacePath(workspacePath)
  if (!normalizedWorkspacePath) {
    return
  }

  ensureLoaded()
  const workspaceState = pendingStateByWorkspace.get(normalizedWorkspacePath)
  if (!workspaceState || workspaceState.commit?.sequence !== sequence) {
    return
  }

  const nextState = cloneWorkspacePendingState(workspaceState)
  nextState.commit = null
  if (nextState.sync === null) {
    pendingStateByWorkspace.delete(normalizedWorkspacePath)
  } else {
    pendingStateByWorkspace.set(normalizedWorkspacePath, nextState)
  }

  persistState()
  notifyListeners()
}

export function endSourceControlSyncOperation(
  workspacePath: string | null | undefined,
  sequence: number,
) {
  const normalizedWorkspacePath = normalizeGitWorkspacePath(workspacePath)
  if (!normalizedWorkspacePath) {
    return
  }

  ensureLoaded()
  const workspaceState = pendingStateByWorkspace.get(normalizedWorkspacePath)
  if (!workspaceState || workspaceState.sync?.sequence !== sequence) {
    return
  }

  const nextState = cloneWorkspacePendingState(workspaceState)
  nextState.sync = null
  if (nextState.commit === null) {
    pendingStateByWorkspace.delete(normalizedWorkspacePath)
  } else {
    pendingStateByWorkspace.set(normalizedWorkspacePath, nextState)
  }

  persistState()
  notifyListeners()
}

export function describeSourceControlPendingAction(
  action: SourceControlPendingCommitAction | SourceControlPendingSyncAction,
) {
  switch (action) {
    case 'commit':
      return 'Committing changes…'
    case 'commit-and-push':
      return 'Committing and pushing changes…'
    case 'commit-and-create-pr':
      return 'Creating commit and pull request…'
    case 'fetch-all':
      return 'Fetching remotes…'
    case 'pull':
      return 'Pulling latest changes…'
    case 'push':
      return 'Pushing changes to remote…'
    case 'refresh':
      return 'Refreshing source control…'
    default: {
      const exhaustiveCheck: never = action
      return exhaustiveCheck
    }
  }
}
