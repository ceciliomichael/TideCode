import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Trash2, X } from 'lucide-react'

interface McpRemoveDialogProps {
  isSubmitting: boolean
  onClose: () => void
  onConfirm: () => void
  serverName: string
}

export function McpRemoveDialog({ isSubmitting, onClose, onConfirm, serverName }: McpRemoveDialogProps) {
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isSubmitting) {
        onClose()
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isSubmitting, onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/12 px-4 py-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSubmitting) {
          onClose()
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mcp-remove-dialog-title"
        className="flex w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-soft"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-6 pt-5 pb-3">
          <div className="min-w-0">
            <h2 id="mcp-remove-dialog-title" className="text-lg font-semibold text-danger-foreground">
              Remove this server?
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              This deletes the MCP config from disk and disconnects any active session for {serverName}.
            </p>
          </div>

          <button
            type="button"
            aria-label="Close remove server dialog"
            onClick={onClose}
            disabled={isSubmitting}
            className="inline-flex h-8 w-8 items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        <div className="shrink-0 bg-surface px-6 py-4">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-border bg-surface-muted px-3.5 text-sm font-medium text-foreground transition-colors hover:bg-border-muted disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={isSubmitting}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-danger-border bg-danger-surface px-3.5 text-sm font-medium text-danger-foreground transition-colors hover:text-danger-foreground-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {isSubmitting ? 'Removing...' : 'Remove server'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
