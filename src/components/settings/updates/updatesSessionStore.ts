import type {
  TideCodeUpdateCheckResult,
  TideCodeUpdateDownloadState,
} from '../../../types/updates'
import { toUserFacingErrorMessage } from '../../../lib/userFacingError'

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
let hasRequestedUpdateCheck = false
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
  return toUserFacingErrorMessage(error, 'TideCode could not check for updates right now.')
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
        pendingVersion: result.downloadVersion ?? (result.updateAvailable ? result.latestVersion : null),
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
    const eventVersion = event.version ?? updatesSessionSnapshot.pendingVersion

    if (event.state === 'downloading') {
      updateSnapshot({
        checkState: 'downloading',
        downloadPercent: event.percent,
        downloadState: 'downloading',
        pendingVersion: eventVersion,
      })
      return
    }

    if (event.state === 'downloaded') {
      updateSnapshot({
        checkState: 'success',
        downloadPercent: 100,
        downloadState: 'downloaded',
        pendingVersion: eventVersion,
      })
      return
    }

    updateSnapshot({
      checkState: 'error',
      downloadPercent: null,
      downloadState: 'error',
      errorMessage: event.errorMessage
        ? toUserFacingErrorMessage(event.errorMessage, 'TideCode could not download this update.')
        : 'TideCode could not download this update.',
      pendingVersion: eventVersion,
    })
  })
}

export function requestUpdateCheck() {
  subscribeToMainProcessState()
  hasRequestedUpdateCheck = true
  void hydrateCachedUpdate()
  const requestId = latestRequestId + 1
  latestRequestId = requestId
  const activeDownloadState =
    updatesSessionSnapshot.downloadState === 'downloading' || updatesSessionSnapshot.downloadState === 'downloaded'
      ? updatesSessionSnapshot.downloadState
      : null
  const activeDownloadVersion = activeDownloadState ? updatesSessionSnapshot.pendingVersion : null
  const activeDownloadPercent = activeDownloadState ? updatesSessionSnapshot.downloadPercent : null

  updateSnapshot({
    checkState: 'checking',
    downloadPercent: activeDownloadState ? updatesSessionSnapshot.downloadPercent : null,
    downloadState: activeDownloadState ?? 'not-available',
    errorMessage: null,
    pendingVersion: activeDownloadVersion,
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

      const reportedDownloadVersion = result.downloadVersion ?? activeDownloadVersion
      const downloadedUpdateIsStillCurrent =
        result.downloadState === 'downloaded' && reportedDownloadVersion === result.latestVersion
      const nextDownloadState =
        result.downloadState === 'not-available' && activeDownloadState
          ? activeDownloadState
          : downloadedUpdateIsStillCurrent
            ? 'downloaded'
            : result.downloadState
      const hasActiveDownload = nextDownloadState === 'downloading' || nextDownloadState === 'downloaded'

      updateSnapshot({
        checkState: result.downloadState === 'error' ? 'error' : 'success',
        currentVersion: result.currentVersion,
        downloadPercent: nextDownloadState === 'downloaded'
          ? 100
          : result.downloadPercent ?? (nextDownloadState === 'downloading' ? activeDownloadPercent : null),
        downloadState: nextDownloadState,
        errorMessage: result.downloadError
          ? toUserFacingErrorMessage(result.downloadError, 'TideCode could not download this update.')
          : null,
        pendingVersion: hasActiveDownload
          ? reportedDownloadVersion ?? result.latestVersion
          : result.updateAvailable
            ? result.latestVersion
            : null,
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

export function requestUpdateCheckForSettingsOpen() {
  if (updatesSessionSnapshot.hasAutoChecked) {
    return
  }

  requestUpdateCheck()
}

export function requestUpdateDownload() {
  subscribeToMainProcessState()
  const latestResult = updatesSessionSnapshot.result
  if (!latestResult?.updateAvailable) {
    return
  }

  // A download for this version is already running or finished: do not reset
  // the progress bar to 0 and start another attempt.
  const downloadIsCurrent =
    (updatesSessionSnapshot.downloadState === 'downloading' ||
      updatesSessionSnapshot.downloadState === 'downloaded') &&
    updatesSessionSnapshot.pendingVersion === (latestResult.downloadVersion ?? latestResult.latestVersion)
  if (downloadIsCurrent) {
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
        errorMessage: downloadResult.downloadError
          ? toUserFacingErrorMessage(downloadResult.downloadError, 'TideCode could not download this update.')
          : null,
        pendingVersion:
          downloadResult.downloadVersion ?? updatesSessionSnapshot.pendingVersion ?? latestResult.latestVersion,
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
  if (hasRequestedUpdateCheck) {
    return
  }

  void hydrateCachedUpdate()
  requestUpdateCheck()
}
