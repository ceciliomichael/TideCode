import type { TideCodeUpdateDownloadState } from '../../types/updates'
import { getRoundedDownloadPercent } from '../settings/updates/updateActionPresentation'

interface SidebarUpdateIndicatorInput {
  downloadPercent: number | null
  downloadState: TideCodeUpdateDownloadState
  updateAvailable: boolean
}

export type SidebarUpdateIndicatorKind = 'hidden' | 'download' | 'downloading' | 'restart'

export interface SidebarUpdateIndicatorPresentation {
  ariaLabel: string
  kind: SidebarUpdateIndicatorKind
  label: string | null
}

export function getSidebarUpdateIndicator({
  downloadPercent,
  downloadState,
  updateAvailable,
}: SidebarUpdateIndicatorInput): SidebarUpdateIndicatorPresentation {
  if (downloadState === 'downloaded') {
    return {
      ariaLabel: 'Restart to install update',
      kind: 'restart',
      label: null,
    }
  }

  if (downloadState === 'downloading') {
    const percent = getRoundedDownloadPercent(downloadPercent)
    return {
      ariaLabel: `Update download ${percent}%`,
      kind: 'downloading',
      label: `${percent}%`,
    }
  }

  if (updateAvailable) {
    return {
      ariaLabel: 'Open Updates',
      kind: 'download',
      label: null,
    }
  }

  return {
    ariaLabel: '',
    kind: 'hidden',
    label: null,
  }
}
