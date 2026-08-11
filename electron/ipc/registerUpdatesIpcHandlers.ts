import { app, ipcMain, shell } from 'electron'
import { getStoredSettings } from '../settings/store'
import {
  checkForUpdates,
  TIDECODE_LATEST_RELEASE_URL,
} from '../updates/githubReleaseService'
import {
  configureAutoUpdater,
  downloadLatestUpdate,
  getUpdateDownloadState,
  restartToInstallUpdate,
} from '../updates/autoUpdateService'
import { requestLatestReleaseWithElectron } from '../updates/electronReleaseRequest'
import { buildCachedUpdateCheckResult, createUpdateReleaseCacheStore } from '../updates/releaseCache'

export function registerUpdatesIpcHandlers(getWindow: () => Electron.BrowserWindow | null) {
  const releaseCache = createUpdateReleaseCacheStore(app.getPath('userData'))

  configureAutoUpdater((event) => {
    const currentWindow = getWindow()
    if (currentWindow && !currentWindow.isDestroyed()) {
      currentWindow.webContents.send('updates:stateChanged', event)
    }
  })

  ipcMain.handle('updates:getCurrentVersion', () => app.getVersion())
  ipcMain.handle('updates:getCachedUpdate', async () => {
    const cachedRelease = await releaseCache.read()
    return cachedRelease ? buildCachedUpdateCheckResult(app.getVersion(), cachedRelease) : null
  })
  ipcMain.handle('updates:checkForUpdates', async () => {
    const result = await checkForUpdates(app.getVersion(), requestLatestReleaseWithElectron)
    try {
      await releaseCache.write({
        checkedAt: result.checkedAt,
        release: result.release,
      })
    } catch (error) {
      console.warn('TideCode could not persist release metadata.', error)
    }

    const existingDownloadStatus = getUpdateDownloadState()
    const shouldDownloadAutomatically = result.updateAvailable && (await getStoredSettings()).autoDownloadUpdates
    if (!shouldDownloadAutomatically || !app.isPackaged) {
      if (existingDownloadStatus.downloadState === 'not-available') {
        return result
      }

      return {
        ...result,
        downloadPercent: existingDownloadStatus.downloadPercent,
        downloadState: existingDownloadStatus.downloadState,
        downloadVersion: existingDownloadStatus.downloadVersion,
      }
    }

    let downloadStatus = existingDownloadStatus
    if (downloadStatus.downloadState === 'not-available') {
      void downloadLatestUpdate(result.latestVersion).catch(() => undefined)
      downloadStatus = getUpdateDownloadState()
    }

    // Report the real download state instead of always claiming a download is
    // starting. Otherwise a repeated check resets the UI to 0% even when the
    // update is already downloaded (or is mid-download at 60%).
    return {
      ...result,
      downloadPercent: downloadStatus.downloadPercent,
      downloadState: downloadStatus.downloadState,
      downloadVersion: downloadStatus.downloadVersion,
    }
  })
  ipcMain.handle('updates:downloadUpdate', async (_event, version: unknown) => {
    if (typeof version !== 'string' || version.trim().length === 0) {
      throw new Error('TideCode received an invalid update version.')
    }

    return downloadLatestUpdate(version)
  })
  ipcMain.handle('updates:openLatestRelease', () => shell.openExternal(TIDECODE_LATEST_RELEASE_URL))
  ipcMain.handle('updates:restartToUpdate', () => restartToInstallUpdate())
}
