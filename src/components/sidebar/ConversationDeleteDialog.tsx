import { AlertTriangle, X } from 'lucide-react'
import { useEffect } from 'react'
import { createPortal } from 'react-dom'

interface ConversationDeleteDialogProps {
  conversationTitle: string
  onClose: () => void
  onConfirm: () => void
}

export function ConversationDeleteDialog({ conversationTitle, onClose, onConfirm }: ConversationDeleteDialogProps) {
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
      className="fixed inset-0 z-[1600] flex items-center justify-center bg-black/30 px-4 py-4 backdrop-blur-[1px]"
      style={{ top: 'env(titlebar-area-height, 0px)' }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="conversation-delete-dialog-title"
        aria-describedby="conversation-delete-dialog-description"
        className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div className="flex min-w-0 items-start gap-3.5">
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-danger-border bg-danger-surface text-danger-foreground">
              <AlertTriangle size={20} />
            </span>
            <div className="min-w-0">
              <h2 id="conversation-delete-dialog-title" className="text-lg font-semibold tracking-tight text-foreground">
                Delete archived chat?
              </h2>
              <p id="conversation-delete-dialog-description" className="mt-1 text-sm leading-6 text-muted-foreground">
                Are you sure you want to permanently delete{' '}
                <span className="font-semibold text-foreground">&quot;{conversationTitle}&quot;</span>? This action cannot be undone.
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close delete confirmation"
            onClick={onClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
          >
            <X size={17} />
          </button>
        </header>

        <footer className="flex items-center justify-end gap-2.5 border-t border-border bg-surface-muted/50 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 items-center justify-center rounded-xl border border-border bg-surface px-4 text-xs font-semibold text-foreground transition-colors hover:bg-surface-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            autoFocus
            className="inline-flex h-10 items-center justify-center rounded-xl border border-danger-border bg-danger-surface px-4 text-xs font-semibold leading-none text-danger-foreground transition-colors hover:opacity-90"
          >
            Delete permanently
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
