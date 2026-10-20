import { AlertTriangle } from 'lucide-react'
import { ConfirmationDialog } from '../ui/ConfirmationDialog'

interface DiscardChangesDialogProps {
  filePaths: string[]
  isBatch: boolean
  onCancel: () => void
  onConfirm: () => void
}

export function DiscardChangesDialog({ filePaths, isBatch, onCancel, onConfirm }: DiscardChangesDialogProps) {
  const title = isBatch
    ? `Discard changes in ${filePaths.length} file${filePaths.length === 1 ? '' : 's'}?`
    : 'Discard unstaged changes?'
  const description = isBatch
    ? 'Untracked files will be deleted. This action cannot be undone.'
    : (
      <>
        Discard unstaged changes to <span className="font-medium text-foreground">{filePaths[0]}</span>? This action
        cannot be undone.
      </>
    )

  return (
    <ConfirmationDialog
      confirmLabel="Discard changes"
      description={description}
      icon={<AlertTriangle size={19} />}
      onCancel={onCancel}
      onConfirm={onConfirm}
      title={title}
      tone="danger"
    />
  )
}
