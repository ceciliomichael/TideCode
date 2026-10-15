import { useEffect, useRef, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { GitCommitHorizontal } from 'lucide-react'

interface ConfirmUnstagedCommitDialogProps {
  confirmDisabled?: boolean
  onCancel: () => void
  onConfirm: () => void
}

export function ConfirmUnstagedCommitDialog({
  confirmDisabled = false,
  onCancel,
  onConfirm,
}: ConfirmUnstagedCommitDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null)
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null)

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

    if (buttons.length === 1) {
      event.preventDefault()
      firstButton.focus()
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
        aria-labelledby="unstaged-commit-confirmation-title"
        aria-describedby="unstaged-commit-confirmation-description"
        className="non-selectable-ui w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-soft"
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-soft-foreground">
            <GitCommitHorizontal size={19} />
          </div>
          <div className="min-w-0">
            <h2 id="unstaged-commit-confirmation-title" className="text-base font-semibold text-foreground">
              Nothing is staged
            </h2>
            <p id="unstaged-commit-confirmation-description" className="mt-1.5 text-sm text-muted-foreground">
              TideCode will stage all current changes, including untracked files, and include them in this commit.
            </p>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={onCancel}
            className="inline-flex h-10 items-center justify-center rounded-xl border border-border bg-surface-muted px-4 text-sm font-medium text-foreground transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-border"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={confirmDisabled}
            onClick={onConfirm}
            className="inline-flex h-10 items-center justify-center rounded-xl bg-action px-4 text-sm font-semibold text-action-foreground transition-colors hover:bg-action-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-border disabled:cursor-not-allowed disabled:opacity-50"
          >
            Stage all and commit
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
