import { GitCommitHorizontal } from 'lucide-react'
import { ConfirmationDialog } from '../ui/ConfirmationDialog'

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
  return (
    <ConfirmationDialog
      confirmDisabled={confirmDisabled}
      confirmLabel="Stage all and commit"
      description="TideCode will stage all current changes, including untracked files, and include them in this commit."
      icon={<GitCommitHorizontal size={19} />}
      onCancel={onCancel}
      onConfirm={onConfirm}
      title="Nothing is staged"
    />
  )
}
