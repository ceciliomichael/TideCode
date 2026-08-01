import { AlertCircle, CheckCircle2, ExternalLink, PackageCheck, RefreshCw, RotateCw } from 'lucide-react'
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { MarkdownRenderer } from '../../chat/MarkdownRenderer'
import { SegmentedField } from '../../ui/SegmentedField'
import {
  getUpdatesSessionSnapshot,
  requestAutomaticUpdateCheck,
  requestUpdateDownload,
  requestUpdateCheck,
  subscribeToUpdatesSession,
  type UpdateCheckState,
} from './updatesSessionStore'
import type { AppSettings } from '../../../types/chat'
import { SettingsPanelLayout, SettingsRow, SettingsSection } from '../shared/SettingsPanelPrimitives'

const BOOLEAN_SEGMENT_OPTIONS = [
  { label: 'Off', value: 'off' },
  { label: 'On', value: 'on' },
] as const

interface UpdatesSettingsPanelProps {
  autoDownloadUpdates: boolean
  isLoading: boolean
  onUpdateSettings: (input: Partial<AppSettings>) => void
}

function formatCheckedAt(value: string | undefined) {
  if (!value) {
    return null
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return null
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function getStatusCopy(
  state: UpdateCheckState,
  downloadState: 'not-available' | 'manual' | 'downloading' | 'downloaded' | 'error',
  updateAvailable: boolean,
  hasResult: boolean,
) {
  if (state === 'checking') {
    return 'Checking the official TideCode releases...'
  }

  if (state === 'downloading' || downloadState === 'downloading') {
    return 'Downloading the update in the background...'
  }

  if (downloadState === 'downloaded') {
    return 'The update is ready. Restart TideCode to finish installing it.'
  }

  if (downloadState === 'error') {
    return 'A newer release was found, but it could not be downloaded.'
  }

  if (state === 'error') {
    return 'We could not confirm the latest release.'
  }

  if (!hasResult) {
    return 'Check when you want to see whether a newer version is available.'
  }

  if (updateAvailable) {
    return 'A newer TideCode release is available. Choose Download update when you are ready.'
  }

  return 'You are running the latest version of TideCode.'
}

export function UpdatesSettingsPanel({ autoDownloadUpdates, isLoading, onUpdateSettings }: UpdatesSettingsPanelProps) {
  const session = useSyncExternalStore(
    subscribeToUpdatesSession,
    getUpdatesSessionSnapshot,
    getUpdatesSessionSnapshot,
  )
  const [openReleaseError, setOpenReleaseError] = useState<string | null>(null)

  useEffect(() => {
    requestAutomaticUpdateCheck()
  }, [])

  const handleManualCheck = useCallback(() => {
    setOpenReleaseError(null)
    requestUpdateCheck()
  }, [])

  const handleDownloadUpdate = useCallback(() => {
    setOpenReleaseError(null)
    requestUpdateDownload()
  }, [])

  const handleAutomaticDownloadsChange = useCallback(
    (nextValue: string) => {
      onUpdateSettings({ autoDownloadUpdates: nextValue === 'on' })
    },
    [onUpdateSettings],
  )

  const handleRestartToUpdate = useCallback(async () => {
    try {
      setOpenReleaseError(null)
      await window.tidecodeUpdates.restartToUpdate()
    } catch (error) {
      setOpenReleaseError(error instanceof Error ? error.message : 'TideCode could not restart to install the update.')
    }
  }, [])

  const handleOpenLatestRelease = useCallback(async () => {
    try {
      setOpenReleaseError(null)
      await window.tidecodeUpdates.openLatestRelease()
    } catch (error) {
      setOpenReleaseError(error instanceof Error ? error.message : 'TideCode could not open the release page.')
    }
  }, [])

  const checkedAt = formatCheckedAt(session.result?.checkedAt)
  const displayedVersion = session.result?.currentVersion ?? session.currentVersion ?? '—'
  const errorMessage = openReleaseError ?? session.errorMessage
  const updateIsReady = session.downloadState === 'downloaded'
  const updateIsAvailable = session.result?.updateAvailable === true
  const isDownloading = session.checkState === 'downloading' || session.downloadState === 'downloading'
  const canCheckAgain = session.result !== null && session.checkState !== 'checking' && !isDownloading
  const statusIcon =
    session.checkState === 'error' ? (
      <AlertCircle size={19} strokeWidth={2} className="text-danger-foreground" aria-hidden="true" />
    ) : session.result?.updateAvailable ? (
      <PackageCheck size={19} strokeWidth={2} className="text-brand" aria-hidden="true" />
    ) : (
      <CheckCircle2 size={19} strokeWidth={2} className="text-brand" aria-hidden="true" />
    )

  return (
    <SettingsPanelLayout>
      <SettingsSection title="Update status">
        <div className="px-4 py-4 md:px-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-6">
            <div className="flex min-w-0 items-start gap-3">
              <div className="mt-0.5 shrink-0" aria-hidden="true">
                {session.checkState === 'checking' || isDownloading ? (
                  <RefreshCw size={19} strokeWidth={2} className="animate-spin text-brand" />
                ) : (
                  statusIcon
                )}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">TideCode {displayedVersion}</p>
                <p className="mt-1 text-sm leading-5 text-muted-foreground">
                  {getStatusCopy(
                    session.checkState,
                    session.downloadState,
                    session.result?.updateAvailable === true,
                    session.result !== null,
                  )}
                </p>
                {isDownloading && session.downloadPercent !== null ? (
                  <p className="mt-2 text-xs text-subtle-foreground">
                    {Math.round(session.downloadPercent)}% downloaded
                  </p>
                ) : null}
                {checkedAt ? <p className="mt-2 text-xs text-subtle-foreground">Last checked {checkedAt}</p> : null}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              {canCheckAgain ? (
                <button
                  type="button"
                  onClick={handleManualCheck}
                  className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-surface-muted"
                >
                  <RefreshCw size={16} strokeWidth={2.2} />
                  Check again
                </button>
              ) : null}
              <button
                type="button"
                disabled={session.checkState === 'checking' || isDownloading}
                onClick={() => {
                  if (updateIsReady) {
                    void handleRestartToUpdate()
                    return
                  }

                  if (updateIsAvailable) {
                    handleDownloadUpdate()
                    return
                  }

                  handleManualCheck()
                }}
                className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-brand-border bg-brand-soft px-4 py-2 text-sm font-semibold text-brand-soft-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {updateIsReady ? (
                  <RotateCw size={16} strokeWidth={2.2} />
                ) : (
                  <RefreshCw
                    size={16}
                    strokeWidth={2.2}
                    className={session.checkState === 'checking' || isDownloading ? 'animate-spin' : undefined}
                  />
                )}
                {updateIsReady
                  ? 'Restart to update'
                  : isDownloading
                    ? 'Downloading...'
                    : updateIsAvailable
                      ? 'Download update'
                      : session.checkState === 'checking'
                        ? 'Checking...'
                        : 'Check for updates'}
              </button>
            </div>
          </div>

          {errorMessage ? (
            <div
              role="alert"
              className="mt-4 rounded-xl border border-danger-border bg-danger-surface px-3 py-2.5 text-sm leading-5 text-danger-foreground"
            >
              {errorMessage}
            </div>
          ) : null}
        </div>
      </SettingsSection>

      {session.result ? (
        <SettingsSection
          title={session.result.updateAvailable ? `TideCode ${session.result.latestVersion} is available` : 'Release details'}
        >
          <div className="px-4 py-4 md:px-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6">
              <div>
                <p className="text-sm font-semibold text-foreground">{session.result.release.name}</p>
                <p className="mt-1 text-sm leading-5 text-muted-foreground">
                  {session.downloadState === 'downloaded'
                    ? 'The update has finished downloading. Restart TideCode to install it.'
                    : session.downloadState === 'error'
                      ? 'TideCode found this release but could not download it. Try again or download it from GitHub instead.'
                      : session.result.updateAvailable
                        ? 'A newer release is available. TideCode will wait for your approval before downloading it.'
                        : 'This release is already installed on your computer.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleOpenLatestRelease()}
                className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-surface-muted"
              >
                View release
                <ExternalLink size={15} strokeWidth={2.2} />
              </button>
            </div>

            <div className="mt-5 border-t border-border pt-4">
              <p className="text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">Release notes</p>
              <div className="mt-3 max-h-80 overflow-y-auto rounded-xl border border-border-muted bg-surface-muted px-3.5 py-3">
                <MarkdownRenderer
                  content={session.result.release.body || 'No release notes were published for this version.'}
                  className="text-sm leading-6"
                />
              </div>
            </div>
          </div>
        </SettingsSection>
      ) : null}

      <SettingsSection title="Update preferences">
        <SettingsRow
          title="Automatic downloads"
          description="When enabled, TideCode downloads a new release after finding it. Updates still require your approval to restart and install."
        >
          <SegmentedField
            ariaLabel="Automatic update downloads"
            disabled={isLoading}
            onChange={handleAutomaticDownloadsChange}
            options={BOOLEAN_SEGMENT_OPTIONS}
            value={autoDownloadUpdates ? 'on' : 'off'}
          />
        </SettingsRow>
      </SettingsSection>

    </SettingsPanelLayout>
  )
}
