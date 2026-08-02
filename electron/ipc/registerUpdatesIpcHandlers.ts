import { app, ipcMain, shell } from 'electron'
import { getStoredSettings } from '../settings/store'
import {
  checkForUpdates,
  TIDECODE_LATEST_RELEASE_URL,
} from '../updates/githubReleaseService'
import { downloadLatestUpdate, configureAutoUpdater, restartToInstallUpdate } from '../updates/autoUpdateService'
import { requestLatestReleaseWithElectron } from '../updates/electronReleaseRequest'

export function registerUpdatesIpcHandlers(getWindow: () => Electron.BrowserWindow | null) {
  configureAutoUpdater((event) => {
    const currentWindow = getWindow()
    if (currentWindow && !currentWindow.isDestroyed()) {
      currentWindow.webContents.send('updates:stateChanged', event)
    }
  })

  ipcMain.handle('updates:getCurrentVersion', () => app.getVersion())
  ipcMain.handle('updates:checkForUpdates', async () => {
    const result = await checkForUpdates(app.getVersion(), requestLatestReleaseWithElectron)
    const shouldDownloadAutomatically = result.updateAvailable && (await getStoredSettings()).autoDownloadUpdates
    if (!shouldDownloadAutomatically || !app.isPackaged) {
      return result
    }

    void downloadLatestUpdate(result.latestVersion).catch(() => undefined)

    return {
      ...result,
      downloadPercent: 0,
      downloadState: 'downloading' as const,
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
