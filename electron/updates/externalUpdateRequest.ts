import { app } from 'electron'
import { checkForUpdates } from './githubReleaseService'
import { requestLatestReleaseWithElectron } from './electronReleaseRequest'
import { downloadLatestUpdate, restartToInstallUpdate } from './autoUpdateService'

let requestedUpdatePromise: Promise<void> | null = null

export function installLatestRequestedUpdate(): Promise<void> {
  if (requestedUpdatePromise) return requestedUpdatePromise
  requestedUpdatePromise = (async () => {
    const result = await checkForUpdates(app.getVersion(), requestLatestReleaseWithElectron)
    if (!result.updateAvailable) return
    const download = await downloadLatestUpdate(result.latestVersion)
    if (download.downloadState !== 'downloaded') {
      throw new Error(download.downloadError || 'TideCode could not download the update.')
    }
    restartToInstallUpdate()
  })().finally(() => {
    requestedUpdatePromise = null
  })
  return requestedUpdatePromise
}
