import { CircleAlert, CircleCheck, Loader2 } from 'lucide-react'
import { AppNoticeSurface } from '../ui/AppNoticeSurface'

export type SourceControlOperationNotice =
  | { kind: 'error'; message: string }
  | { kind: 'warning'; message: string }
  | { kind: 'success'; message: string }

interface SourceControlOperationStatusProps {
  notice: SourceControlOperationNotice | null
  pendingMessage: string | null
}

export function SourceControlOperationStatus({
  notice,
  pendingMessage,
}: SourceControlOperationStatusProps) {
  const kind = pendingMessage ? 'pending' : notice?.kind
  const message = pendingMessage ?? notice?.message

  if (!kind || !message) {
    return null
  }

  if (kind === 'error') {
    return (
      <div className="shrink-0 px-3 py-2">
        <AppNoticeSurface title="Source control action failed" message={message} fallbackMessage="The Git action could not be completed. Try again." />
      </div>
    )
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={[
        'flex min-h-9 shrink-0 items-center gap-2 border-b px-4 py-2 text-[12px]',
        kind === 'warning'
          ? 'border-warning-border bg-warning-surface text-warning-foreground'
          : 'border-border bg-surface-muted text-muted-foreground',
      ].join(' ')}
    >
      {kind === 'pending' ? (
        <Loader2 size={13} className="shrink-0 animate-spin" aria-hidden="true" />
      ) : kind === 'success' ? (
        <CircleCheck size={13} className="shrink-0" aria-hidden="true" />
      ) : (
        <CircleAlert size={13} className="shrink-0" aria-hidden="true" />
      )}
      <span className="min-w-0 break-words">{message}</span>
    </div>
  )
}
