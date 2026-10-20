import { X } from 'lucide-react'
import type { HTMLAttributes, ReactNode } from 'react'
import { toUserFacingErrorMessage } from '../../lib/userFacingError'

interface AppNoticeSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  title: string
  message?: string | null
  fallbackMessage?: string
  onDismiss?: () => void
  action?: { label: string; onClick: () => void; disabled?: boolean }
  children?: ReactNode
  mode?: 'inline' | 'toast'
  ariaLabel?: string
  dismissLabel?: string
}

export function AppNoticeSurface({
  title,
  message,
  fallbackMessage,
  onDismiss,
  action,
  children,
  mode = 'inline',
  ariaLabel,
  dismissLabel = 'Dismiss notification',
  className = '',
  role = 'alert',
  ...events
}: AppNoticeSurfaceProps) {
  const description = message !== undefined && message !== null
    ? toUserFacingErrorMessage(message, fallbackMessage ?? 'This action could not be completed. Try again.')
    : fallbackMessage ?? null

  return (
    <div
      {...events}
      role={role}
      aria-label={ariaLabel}
      className={[
        'relative min-w-0 rounded-xl border border-border bg-surface-raised p-3 text-foreground shadow-lg',
        mode === 'toast' ? 'w-[380px] max-w-[calc(100%-1.5rem)]' : 'w-full',
        className,
      ].join(' ')}
    >
      {onDismiss ? (
        <button
          type="button"
          aria-label={dismissLabel}
          onClick={onDismiss}
          className="absolute right-1.5 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
        >
          <X size={14} aria-hidden="true" />
        </button>
      ) : null}
      <div role={role === 'region' ? 'status' : undefined} className={['text-sm font-medium', onDismiss ? 'pr-6' : ''].join(' ')}>
        {title}
      </div>
      {description ? <p className="mt-1.5 break-words text-xs leading-5 text-muted-foreground">{description}</p> : null}
      {children}
      {action ? (
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            disabled={action.disabled}
            onClick={action.onClick}
            className="rounded-lg bg-action px-3 py-1.5 text-xs font-medium text-action-foreground transition-colors hover:bg-action-hover disabled:opacity-50"
          >
            {action.label}
          </button>
        </div>
      ) : null}
    </div>
  )
}
