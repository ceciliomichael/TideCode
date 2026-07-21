import { Loader2, Trash2 } from 'lucide-react'
import { createPortal } from 'react-dom'
import type { CustomModelConfig } from '../../../types/chat'

interface RemoveUserModelDialogProps {
  isRemoving: boolean
  model: CustomModelConfig
  onCancel: () => void
  onConfirm: () => Promise<void>
}

export function RemoveUserModelDialog({
  isRemoving,
  model,
  onCancel,
  onConfirm,
}: RemoveUserModelDialogProps) {
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="remove-user-model-title"
        className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-soft"
      >
        <h2 id="remove-user-model-title" className="text-lg font-semibold text-foreground">Remove {model.label}?</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          The model will disappear from your model picker. Your provider connection will not be changed.
        </p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={isRemoving}
            className="h-11 rounded-xl border border-border bg-surface px-4 text-sm font-medium text-foreground hover:bg-surface-muted disabled:opacity-50"
          >
            Keep model
          </button>
          <button
            type="button"
            onClick={() => void onConfirm()}
            disabled={isRemoving}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-danger-border bg-danger-surface px-4 text-sm font-medium text-danger-foreground transition-colors active:scale-[0.98] disabled:opacity-50"
          >
            {isRemoving ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
            Remove model
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
