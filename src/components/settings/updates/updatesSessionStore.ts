import type {
  TideCodeUpdateCheckResult,
  TideCodeUpdateDownloadState,
} from '../../../types/updates'

export type UpdateCheckState = 'idle' | 'checking' | 'downloading' | 'success' | 'error'

export interface UpdatesSessionSnapshot {
  checkState: UpdateCheckState
  currentVersion: string | null
  downloadPercent: number | null
  downloadState: TideCodeUpdateDownloadState
  errorMessage: string | null
  hasAutoChecked: boolean
  pendingVersion: string | null
  result: TideCodeUpdateCheckResult | null
}

const INITIAL_UPDATES_SESSION_SNAPSHOT: UpdatesSessionSnapshot = {
  checkState: 'idle',
  currentVersion: null,
  downloadPercent: null,
  downloadState: 'not-available',
  errorMessage: null,
  hasAutoChecked: false,
  pendingVersion: null,
  result: null,
}

let updatesSessionSnapshot = INITIAL_UPDATES_SESSION_SNAPSHOT
let latestRequestId = 0
const listeners = new Set<() => void>()
let hasHydratedCachedUpdate = false
let cachedUpdateHydrationPromise: Promise<void> | null = null

function publishSnapshot(nextSnapshot: UpdatesSessionSnapshot) {
  updatesSessionSnapshot = nextSnapshot
  listeners.forEach((listener) => listener())
}

function updateSnapshot(patch: Partial<UpdatesSessionSnapshot>) {
  publishSnapshot({ ...updatesSessionSnapshot, ...patch })
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'TideCode could not check for updates right now.'
}

export function hydrateCachedUpdate() {
  if (hasHydratedCachedUpdate) {
    return cachedUpdateHydrationPromise ?? Promise.resolve()
  }

  hasHydratedCachedUpdate = true
  if (typeof window === 'undefined' || !window.tidecodeUpdates) {
    return Promise.resolve()
  }

  cachedUpdateHydrationPromise = window.tidecodeUpdates
    .getCachedUpdate()
    .then((result) => {
      if (!result || updatesSessionSnapshot.result) {
        return
      }

      updateSnapshot({
        checkState: updatesSessionSnapshot.checkState === 'checking' ? 'checking' : 'success',
        currentVersion: result.currentVersion,
        downloadPercent: null,
        downloadState: 'not-available',
        errorMessage: null,
        pendingVersion: result.updateAvailable ? result.latestVersion : null,
        result,
      })
    })
    .catch(() => undefined)

  return cachedUpdateHydrationPromise
}

export function getUpdatesSessionSnapshot() {
  return updatesSessionSnapshot
}

export function subscribeToUpdatesSession(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

let hasSubscribedToMainProcessState = false

function subscribeToMainProcessState() {
  if (hasSubscribedToMainProcessState || typeof window === 'undefined' || !window.tidecodeUpdates) {
    return
  }

  hasSubscribedToMainProcessState = true
  window.tidecodeUpdates.onUpdateState((event) => {
    if (event.state === 'downloading') {
      updateSnapshot({
        checkState: 'downloading',
        downloadPercent: event.percent,
        downloadState: 'downloading',
        pendingVersion: event.version,
      })
      return
    }

    if (event.state === 'downloaded') {
      updateSnapshot({
        checkState: 'success',
        downloadPercent: 100,
        downloadState: 'downloaded',
        pendingVersion: event.version,
      })
      return
    }

    updateSnapshot({
      checkState: 'error',
      downloadPercent: null,
      downloadState: 'error',
      errorMessage: event.errorMessage ?? 'TideCode could not download this update.',
      pendingVersion: event.version,
    })
  })
}

export function requestUpdateCheck() {
  subscribeToMainProcessState()
  void hydrateCachedUpdate()
  const requestId = latestRequestId + 1
  latestRequestId = requestId
  const downloadedVersion =
    updatesSessionSnapshot.downloadState === 'downloaded' ? updatesSessionSnapshot.pendingVersion : null

  updateSnapshot({
    checkState: 'checking',
    downloadPercent: downloadedVersion ? 100 : null,
    downloadState: downloadedVersion ? 'downloaded' : 'not-available',
    errorMessage: null,
    pendingVersion: downloadedVersion,
  })

  void window.tidecodeUpdates
    .getCurrentVersion()
    .then((currentVersion) => {
      if (requestId === latestRequestId) {
        updateSnapshot({ currentVersion })
      }
    })
    .catch(() => undefined)

  void window.tidecodeUpdates
    .checkForUpdates()
    .then((result) => {
      if (requestId !== latestRequestId) {
        return
      }

      const downloadedUpdateIsStillCurrent = downloadedVersion === result.latestVersion

      updateSnapshot({
        checkState: result.downloadState === 'error' ? 'error' : 'success',
        currentVersion: result.currentVersion,
        downloadPercent: downloadedUpdateIsStillCurrent ? 100 : result.downloadPercent,
        downloadState: downloadedUpdateIsStillCurrent ? 'downloaded' : result.downloadState,
        errorMessage: result.downloadError ?? null,
        pendingVersion: downloadedUpdateIsStillCurrent ? downloadedVersion : result.latestVersion,
        result,
      })
    })
    .catch((error: unknown) => {
      if (requestId !== latestRequestId) {
        return
      }

      updateSnapshot({
        checkState: 'error',
        errorMessage: getErrorMessage(error),
      })
  })
}

export function requestUpdateDownload() {
  subscribeToMainProcessState()
  const latestResult = updatesSessionSnapshot.result
  if (!latestResult?.updateAvailable) {
    return
  }

  const requestId = latestRequestId + 1
  latestRequestId = requestId
  updateSnapshot({
    checkState: 'downloading',
    downloadPercent: 0,
    downloadState: 'downloading',
    errorMessage: null,
    pendingVersion: latestResult.latestVersion,
  })

  void window.tidecodeUpdates
    .downloadUpdate(latestResult.latestVersion)
    .then((downloadResult) => {
      if (requestId !== latestRequestId) {
        return
      }

      updateSnapshot({
        checkState: downloadResult.downloadState === 'error' ? 'error' : 'success',
        downloadPercent: downloadResult.downloadPercent,
        downloadState: downloadResult.downloadState,
        errorMessage: downloadResult.downloadError ?? null,
      })
    })
    .catch((error: unknown) => {
      if (requestId !== latestRequestId) {
        return
      }

      updateSnapshot({
        checkState: 'error',
        downloadState: 'error',
        downloadPercent: null,
        errorMessage: getErrorMessage(error),
      })
    })
}

export function requestAutomaticUpdateCheck() {
  subscribeToMainProcessState()
  if (updatesSessionSnapshot.hasAutoChecked) {
    return
  }

  updateSnapshot({ hasAutoChecked: true })
  void hydrateCachedUpdate()
  requestUpdateCheck()
}
