import { CircleAlert, CircleCheck, Loader2 } from 'lucide-react'

export type SourceControlOperationNotice =
  | { kind: 'error'; message: string }
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

  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      aria-live={kind === 'error' ? 'assertive' : 'polite'}
      className={[
        'flex min-h-9 shrink-0 items-center gap-2 border-b px-4 py-2 text-[12px]',
        kind === 'error'
          ? 'border-danger-border bg-danger-surface text-danger-foreground'
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
