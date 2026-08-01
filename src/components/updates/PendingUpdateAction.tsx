import { RotateCw } from 'lucide-react'
import { useState, useSyncExternalStore } from 'react'
import {
  getUpdatesSessionSnapshot,
  subscribeToUpdatesSession,
} from '../settings/updates/updatesSessionStore'

export function PendingUpdateAction() {
  const session = useSyncExternalStore(
    subscribeToUpdatesSession,
    getUpdatesSessionSnapshot,
    getUpdatesSessionSnapshot,
  )
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  if (session.downloadState !== 'downloaded') {
    return null
  }

  const handleRestart = async () => {
    try {
      setErrorMessage(null)
      await window.tidecodeUpdates.restartToUpdate()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'TideCode could not restart to install the update.')
    }
  }

  return (
    <button
      type="button"
      aria-label="Restart TideCode to install the downloaded update"
      className="app-no-drag pointer-events-auto inline-flex min-h-8 min-w-0 items-center gap-1.5 rounded-lg border border-brand-border bg-brand-soft px-2.5 py-1 text-xs font-semibold text-brand-soft-foreground transition-colors hover:bg-accent-hover"
      onClick={() => void handleRestart()}
      title={errorMessage ?? 'Restart TideCode to install the downloaded update'}
    >
      <RotateCw size={13} strokeWidth={2.3} />
      Restart to update
    </button>
  )
}
