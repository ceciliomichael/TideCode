import type { TideCodeUpdateDownloadState } from '../../../types/updates'
import type { UpdateCheckState } from './updatesSessionStore'

interface UpdateVersionDisplayInput {
  checkState: UpdateCheckState
  currentVersion: string | null
  downloadState: TideCodeUpdateDownloadState
  latestVersion: string | null
  pendingVersion: string | null
}

export function getDisplayedUpdateVersion({
  checkState,
  currentVersion,
  downloadState,
  latestVersion,
  pendingVersion,
}: UpdateVersionDisplayInput) {
  const isDownloading = checkState === 'downloading' || downloadState === 'downloading'
  const isDownloaded = downloadState === 'downloaded'

  if (isDownloading || isDownloaded) {
    return pendingVersion ?? latestVersion ?? currentVersion ?? '—'
  }

  return currentVersion ?? '—'
}
