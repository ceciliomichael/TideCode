import { GitCompareArrows } from 'lucide-react'
import { Tooltip } from '../Tooltip'

interface DiffPanelToggleProps {
  isOpen: boolean
  onToggle: () => void
  totalAddedLineCount: number
  totalRemovedLineCount: number
}

export function DiffPanelToggle({
  isOpen,
  onToggle,
  totalAddedLineCount,
  totalRemovedLineCount,
}: DiffPanelToggleProps) {
  return (
    <Tooltip content={isOpen ? 'Hide diff panel' : 'Show diff panel'} side="bottom">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={onToggle}
        className="inline-flex h-10 items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <GitCompareArrows size={16} className="shrink-0" />
        <span className="text-git-added">{`+${totalAddedLineCount}`}</span>
        <span className="text-git-removed">{`-${totalRemovedLineCount}`}</span>
      </button>
    </Tooltip>
  )
}
