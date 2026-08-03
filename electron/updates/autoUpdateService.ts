import { app } from 'electron'
import { autoUpdater, type ProgressInfo } from 'electron-updater'
import type { TideCodeUpdateDownloadResult, TideCodeUpdateStateEvent } from '../../src/types/updates'
import { normalizeSemanticVersion } from './releaseVersion'

type UpdateStateListener = (event: TideCodeUpdateStateEvent) => void

let hasBeenConfigured = false
let updateIsDownloaded = false
let pendingVersion: string | null = null
let stateListener: UpdateStateListener | null = null
let updateInstallInProgress = false
let downloadPromise: Promise<TideCodeUpdateDownloadResult> | null = null
let latestDownloadPercent: number | null = null

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'TideCode could not download this update.'
}

function emitState(event: TideCodeUpdateStateEvent) {
  stateListener?.(event)
}

function handleDownloadProgress(progress: ProgressInfo) {
  latestDownloadPercent = Math.max(0, Math.min(100, progress.percent))
  emitState({
    percent: latestDownloadPercent,
    state: 'downloading',
    version: pendingVersion,
  })
}

export function configureAutoUpdater(listener: UpdateStateListener) {
  stateListener = listener

  if (hasBeenConfigured) {
    return
  }

  hasBeenConfigured = true
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false
  // Disable differential (blockmap) downloads. electron-updater first downloads
  // only the changed blocks and patches the previously cached installer into
  // the new one; when that patch fails (stale or mismatched cached installer,
  // missing old blockmap, antivirus interference) it silently falls back to a
  // full download. The result is the update being "downloaded" twice in a row:
  // progress goes 0-100, resets to 0, then runs 0-100 again. A single full
  // download is predictable and avoids the doubled transfer.
  autoUpdater.disableDifferentialDownload = true
  autoUpdater.on('download-progress', handleDownloadProgress)
  autoUpdater.on('update-downloaded', () => {
    updateIsDownloaded = true
    latestDownloadPercent = 100
    emitState({
      percent: 100,
      state: 'downloaded',
      version: pendingVersion,
    })
  })
}

async function downloadLatestUpdateInternal(normalizedVersion: string): Promise<TideCodeUpdateDownloadResult> {
  if (!app.isPackaged) {
    return {
      downloadError: undefined,
      downloadPercent: null,
      downloadState: 'manual' as const,
    }
  }

  if (updateIsDownloaded) {
    return {
      downloadError: undefined,
      downloadPercent: 100,
      downloadState: 'downloaded' as const,
    }
  }

  pendingVersion = normalizedVersion

  try {
    const updateCheck = await autoUpdater.checkForUpdates()
    if (!updateCheck?.isUpdateAvailable) {
      return {
        downloadError: 'The release is available, but this installer could not prepare it automatically.',
        downloadPercent: null,
        downloadState: 'error' as const,
      }
    }

    latestDownloadPercent = 0
    emitState({ percent: 0, state: 'downloading', version: pendingVersion })
    await autoUpdater.downloadUpdate()
    updateIsDownloaded = true
    latestDownloadPercent = 100
    emitState({ percent: 100, state: 'downloaded', version: pendingVersion })

    return {
      downloadError: undefined,
      downloadPercent: 100,
      downloadState: 'downloaded' as const,
    }
  } catch (error) {
    const downloadError = getErrorMessage(error)
    latestDownloadPercent = null
    emitState({
      errorMessage: downloadError,
      percent: null,
      state: 'error',
      version: pendingVersion,
    })

    return {
      downloadError,
      downloadPercent: null,
      downloadState: 'error' as const,
    }
  }
}

export function getUpdateDownloadState(): Pick<
  TideCodeUpdateDownloadResult,
  'downloadPercent' | 'downloadState'
> {
  if (updateIsDownloaded) {
    return { downloadPercent: 100, downloadState: 'downloaded' }
  }

  if (downloadPromise) {
    return { downloadPercent: latestDownloadPercent ?? 0, downloadState: 'downloading' }
  }

  return { downloadPercent: null, downloadState: 'not-available' }
}

export function downloadLatestUpdate(version: string): Promise<TideCodeUpdateDownloadResult> {
  let normalizedVersion: string
  try {
    normalizedVersion = normalizeSemanticVersion(version)
  } catch {
    throw new Error('TideCode received an invalid update version.')
  }

  if (downloadPromise) {
    return downloadPromise
  }

  const nextDownloadPromise = downloadLatestUpdateInternal(normalizedVersion)
  downloadPromise = nextDownloadPromise
  void nextDownloadPromise.then(
    () => {
      if (downloadPromise === nextDownloadPromise) {
        downloadPromise = null
      }
    },
    () => {
      if (downloadPromise === nextDownloadPromise) {
        downloadPromise = null
      }
    },
  )

  return nextDownloadPromise
}

export function restartToInstallUpdate() {
  if (!app.isPackaged) {
    throw new Error('Updates can only be installed from a packaged TideCode build.')
  }

  if (!updateIsDownloaded) {
    throw new Error('No downloaded update is ready to install.')
  }

  if (updateInstallInProgress) {
    return
  }

  updateInstallInProgress = true
  try {
    // The update is already downloaded. Hand off directly to the branded
    // installer so the restart action does not open a second update flow.
    // Force the updated application to launch again after installation.
    autoUpdater.quitAndInstall(false, true)
  } catch (error) {
    updateInstallInProgress = false
    throw error
  }
}

export function isUpdateInstallInProgress() {
  return updateInstallInProgress
}
