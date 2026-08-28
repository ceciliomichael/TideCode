import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Trash2, X } from 'lucide-react'

interface KanbanDeleteTaskDialogProps {
  isSubmitting?: boolean
  subtaskCount: number
  taskTitle: string
  onClose: () => void
  onConfirm: () => void
}

export function KanbanDeleteTaskDialog({
  isSubmitting = false,
  subtaskCount,
  taskTitle,
  onClose,
  onConfirm,
}: KanbanDeleteTaskDialogProps) {
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isSubmitting) {
        onClose()
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [isSubmitting, onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-[1600] flex items-center justify-center bg-black/30 px-4 py-4 backdrop-blur-[1px]"
      style={{ top: 'env(titlebar-area-height, 0px)' }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSubmitting) {
          onClose()
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="kanban-delete-dialog-title"
        aria-describedby="kanban-delete-dialog-description"
        className="non-selectable-ui w-full max-w-md overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div className="flex min-w-0 items-start gap-3.5">
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-danger-border bg-danger-surface text-danger-foreground">
              <AlertTriangle size={20} />
            </span>
            <div className="min-w-0">
              <h2
                id="kanban-delete-dialog-title"
                className="text-lg font-semibold tracking-tight text-foreground"
              >
                Delete task?
              </h2>
              <p
                id="kanban-delete-dialog-description"
                className="mt-1 text-sm leading-6 text-muted-foreground"
              >
                Are you sure you want to delete{' '}
                <span className="font-semibold text-foreground">
                  "{taskTitle}"
                </span>
                ?
                {subtaskCount > 0
                  ? ` Its ${subtaskCount} subtask${subtaskCount === 1 ? '' : 's'} will also be permanently deleted.`
                  : ' This action cannot be undone.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close delete confirmation"
            onClick={onClose}
            disabled={isSubmitting}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground disabled:opacity-50"
          >
            <X size={17} />
          </button>
        </header>

        <footer className="flex items-center justify-end gap-2.5 border-t border-border bg-surface-muted/50 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="inline-flex h-10 items-center justify-center rounded-xl border border-border bg-surface px-4 text-xs font-semibold text-foreground transition-colors hover:bg-surface-muted disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
            autoFocus
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-danger-border bg-danger-surface px-4 text-xs font-semibold text-danger-foreground transition-colors hover:opacity-90 disabled:opacity-50"
          >
            <Trash2 size={15} className="shrink-0" />
            {isSubmitting ? 'Deleting…' : 'Delete permanently'}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
