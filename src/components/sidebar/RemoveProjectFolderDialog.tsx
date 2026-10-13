import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

interface RemoveProjectFolderDialogProps {
  folderName: string
  isBusy: boolean
  onCancel: () => void
  onConfirm: () => void
}

export function RemoveProjectFolderDialog({
  folderName,
  isBusy,
  onCancel,
  onConfirm,
}: RemoveProjectFolderDialogProps) {
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isBusy) {
        onCancel()
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isBusy, onCancel])

  return createPortal(
    <div
      className="fixed inset-x-0 bottom-0 z-[1000] flex items-center justify-center bg-overlay-backdrop px-4"
      style={{ top: 'env(titlebar-area-height, 0px)' }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isBusy) {
          onCancel()
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="remove-project-folder-title"
        className="w-full max-w-md rounded-2xl border border-border bg-surface p-4 shadow-soft"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="remove-project-folder-title" className="text-base font-semibold text-foreground">
              Remove project folder?
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              This will remove <span className="font-medium text-foreground">{folderName}</span> and permanently delete its
              threads.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close remove project folder dialog"
            onClick={onCancel}
            disabled={isBusy}
            className="inline-flex h-8 w-8 items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isBusy}
            className="inline-flex h-10 items-center justify-center rounded-xl border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isBusy}
            className="inline-flex h-10 items-center justify-center rounded-xl bg-danger-surface px-3 text-sm font-medium text-danger-foreground transition-colors hover:bg-danger-surface disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isBusy ? 'Removing...' : 'Remove project'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
