import { AlertTriangle, X } from 'lucide-react'
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { WorkspaceExplorerErrorDialogState } from './workspaceExplorerPanelTypes'

interface WorkspaceExplorerErrorDialogProps {
  onClose: () => void
  state: WorkspaceExplorerErrorDialogState
}

export function WorkspaceExplorerErrorDialog({ onClose, state }: WorkspaceExplorerErrorDialogProps) {
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
      className="fixed inset-0 z-[1400] flex items-center justify-center bg-black/20 px-4 py-4"
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
        aria-labelledby="workspace-explorer-error-dialog-title"
        aria-describedby="workspace-explorer-error-dialog-description"
        className="non-selectable-ui w-full max-w-md overflow-hidden rounded-2xl border border-border bg-surface"
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-danger-border bg-danger-surface text-danger-foreground">
              <AlertTriangle size={18} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 id="workspace-explorer-error-dialog-title" className="text-lg font-semibold text-foreground">
                {state.title}
              </h2>
              <p
                id="workspace-explorer-error-dialog-description"
                className="mt-1 text-sm leading-6 text-muted-foreground"
              >
                {state.message}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close message"
            onClick={onClose}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
          >
            <X size={17} aria-hidden="true" />
          </button>
        </header>

        <footer className="flex items-center justify-end border-t border-border px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            autoFocus
            className="inline-flex h-11 items-center justify-center rounded-xl bg-action px-5 text-sm font-semibold text-white transition-colors hover:bg-action-hover"
          >
            Got it
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  )
}
