import { AlertTriangle, X } from 'lucide-react'
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { KanbanUserFacingError } from './kanbanErrorPresentation'

interface KanbanErrorDialogProps {
  error: KanbanUserFacingError
  onClose: () => void
  onReviewTask?: () => void
}

export function KanbanErrorDialog({
  error,
  onClose,
  onReviewTask,
}: KanbanErrorDialogProps) {
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-[1700] flex items-center justify-center bg-black/20 px-4 py-4"
      style={{ top: 'env(titlebar-area-height, 0px)' }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="kanban-error-dialog-title"
        aria-describedby="kanban-error-dialog-description"
        className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-surface"
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-danger-border bg-danger-surface text-danger-foreground">
              <AlertTriangle size={18} />
            </span>
            <div className="min-w-0">
              <h2
                id="kanban-error-dialog-title"
                className="text-lg font-semibold text-foreground"
              >
                {error.title}
              </h2>
              <p
                id="kanban-error-dialog-description"
                className="mt-1 text-sm leading-6 text-muted-foreground"
              >
                {error.description}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close message"
            onClick={onClose}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
          >
            <X size={17} />
          </button>
        </header>

        {error.guidance ? (
          <div className="px-5 py-4">
            <p className="rounded-xl border border-border bg-surface-muted px-4 py-3 text-sm leading-6 text-foreground">
              {error.guidance}
            </p>
          </div>
        ) : null}

        <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
          {onReviewTask ? (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-11 items-center justify-center rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-foreground transition-colors hover:bg-surface-muted"
            >
              Not now
            </button>
          ) : null}
          <button
            type="button"
            onClick={onReviewTask ?? onClose}
            autoFocus
            className="inline-flex h-11 items-center justify-center rounded-xl bg-action px-5 text-sm font-semibold text-white transition-colors hover:bg-action-hover"
          >
            {onReviewTask ? 'Review task' : 'Got it'}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  )
}
