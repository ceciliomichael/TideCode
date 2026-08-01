export interface TideCodeUpdateRelease {
  body: string
  htmlUrl: string
  name: string
  publishedAt: string | null
  tagName: string
  version: string
}

export type TideCodeUpdateDownloadState = 'not-available' | 'manual' | 'downloading' | 'downloaded' | 'error'

export interface TideCodeUpdateCheckResult {
  checkedAt: string
  currentVersion: string
  downloadError?: string
  downloadPercent: number | null
  downloadState: TideCodeUpdateDownloadState
  latestVersion: string
  release: TideCodeUpdateRelease
  updateAvailable: boolean
}

export interface TideCodeUpdateDownloadResult {
  downloadError?: string
  downloadPercent: number | null
  downloadState: TideCodeUpdateDownloadState
}

export interface TideCodeUpdateStateEvent {
  errorMessage?: string
  percent: number | null
  state: 'downloading' | 'downloaded' | 'error'
  version: string | null
}

export interface TideCodeUpdatesApi {
  checkForUpdates: () => Promise<TideCodeUpdateCheckResult>
  downloadUpdate: (version: string) => Promise<TideCodeUpdateDownloadResult>
  getCurrentVersion: () => Promise<string>
  openLatestRelease: () => Promise<void>
  onUpdateState: (listener: (event: TideCodeUpdateStateEvent) => void) => () => void
  restartToUpdate: () => Promise<void>
}
