import type { TideCodeUpdateDownloadState } from '../../../types/updates'
import type { UpdateCheckState } from './updatesSessionStore'

interface TargetUpdateVersionInput {
  downloadState: TideCodeUpdateDownloadState
  latestVersion: string | null
  pendingVersion: string | null
  updateAvailable: boolean
}

interface UpdateActionPresentationInput {
  checkState: UpdateCheckState
  downloadPercent: number | null
  downloadState: TideCodeUpdateDownloadState
  hasResult: boolean
  targetVersion: string | null
  updateAvailable: boolean
}

export type UpdateActionKind = 'check' | 'checking' | 'download' | 'downloading' | 'restart'

export interface UpdateActionPresentation {
  ariaLabel: string
  disabled: boolean
  kind: UpdateActionKind
  label: string | null
}

export function getTargetUpdateVersion({
  downloadState,
  latestVersion,
  pendingVersion,
  updateAvailable,
}: TargetUpdateVersionInput) {
  if (downloadState === 'downloading' || downloadState === 'downloaded') {
    return pendingVersion ?? latestVersion
  }

  return updateAvailable ? latestVersion : null
}

export function getRoundedDownloadPercent(percent: number | null) {
  if (percent === null || !Number.isFinite(percent)) {
    return 0
  }

  return Math.round(Math.max(0, Math.min(100, percent)))
}

export function getUpdateActionPresentation({
  checkState,
  downloadPercent,
  downloadState,
  hasResult,
  targetVersion,
  updateAvailable,
}: UpdateActionPresentationInput): UpdateActionPresentation {
  if (downloadState === 'downloaded') {
    const target = targetVersion ? ` to TideCode ${targetVersion}` : ''
    return {
      ariaLabel: `Restart to install update${target}`,
      disabled: false,
      kind: 'restart',
      label: null,
    }
  }

  if (checkState === 'downloading' || downloadState === 'downloading') {
    const percent = getRoundedDownloadPercent(downloadPercent)
    const target = targetVersion ? ` TideCode ${targetVersion}` : ' the update'
    return {
      ariaLabel: `Downloading${target}: ${percent}%`,
      disabled: true,
      kind: 'downloading',
      label: `${percent}%`,
    }
  }

  if (updateAvailable) {
    return {
      ariaLabel: 'Download update',
      disabled: false,
      kind: 'download',
      label: 'Download update',
    }
  }

  if (checkState === 'checking') {
    return {
      ariaLabel: 'Checking for updates',
      disabled: true,
      kind: 'checking',
      label: 'Checking...',
    }
  }

  return {
    ariaLabel: hasResult ? 'Check again for updates' : 'Check for updates',
    disabled: false,
    kind: 'check',
    label: hasResult ? 'Check again' : 'Check for updates',
  }
}
