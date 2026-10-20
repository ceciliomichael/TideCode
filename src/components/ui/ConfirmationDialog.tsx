import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface ConfirmationDialogProps {
  cancelLabel?: string
  confirmDisabled?: boolean
  confirmLabel: string
  description: ReactNode
  icon: ReactNode
  onCancel: () => void
  onConfirm: () => void
  tone?: 'default' | 'danger'
  title: string
}

export function ConfirmationDialog({
  cancelLabel = 'Cancel',
  confirmDisabled = false,
  confirmLabel,
  description,
  icon,
  onCancel,
  onConfirm,
  tone = 'default',
  title,
}: ConfirmationDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null)
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const activeElement = document.activeElement
    if (activeElement instanceof HTMLElement) {
      previouslyFocusedElementRef.current = activeElement
    }

    cancelButtonRef.current?.focus()

    return () => {
      const previouslyFocusedElement = previouslyFocusedElementRef.current
      if (previouslyFocusedElement?.isConnected) {
        previouslyFocusedElement.focus()
      }
    }
  }, [])

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onCancel()
      return
    }

    if (event.key !== 'Tab') {
      return
    }

    const buttons = dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
    if (!buttons || buttons.length === 0) {
      return
    }

    const firstButton = buttons.item(0)
    const lastButton = buttons.item(buttons.length - 1)
    if (!firstButton || !lastButton) {
      return
    }

    if (event.shiftKey && document.activeElement === firstButton) {
      event.preventDefault()
      lastButton.focus()
    } else if (!event.shiftKey && document.activeElement === lastButton) {
      event.preventDefault()
      firstButton.focus()
    }
  }

  const confirmButtonClassName = tone === 'danger'
    ? 'border border-danger-border bg-danger-surface text-danger-foreground hover:text-danger-foreground-hover'
    : 'bg-action text-action-foreground hover:bg-action-hover'

  return createPortal(
    <div
      className="fixed inset-x-0 bottom-0 z-[60] flex items-center justify-center bg-overlay-backdrop px-4"
      style={{ top: 'env(titlebar-area-height, 0px)' }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel()
        }
      }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="non-selectable-ui w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-soft"
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-start gap-3">
          <div
            className={
              tone === 'danger'
                ? 'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-danger-surface text-danger-foreground'
                : 'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-soft-foreground'
            }
          >
            {icon}
          </div>
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-foreground">
              {title}
            </h2>
            <div id={descriptionId} className="mt-1.5 text-sm text-muted-foreground">
              {description}
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={onCancel}
            className="inline-flex h-10 items-center justify-center rounded-xl border border-border bg-surface-muted px-4 text-sm font-medium text-foreground transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-border"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={confirmDisabled}
            onClick={onConfirm}
            className={`inline-flex h-10 items-center justify-center rounded-xl px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-border disabled:cursor-not-allowed disabled:opacity-50 ${confirmButtonClassName}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
