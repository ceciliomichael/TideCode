import { FolderTree, Menu, PanelLeft, SquarePen, X } from 'lucide-react'
import { Tooltip } from '../Tooltip'

interface WorkspaceFloatingControlsProps {
  isSidebarOpen: boolean
  onToggleSidebar: () => void
  newThreadButton?: {
    onClick: () => void
    tooltip?: string
  }
  explorerButton?: {
    isActive: boolean
    onClick: () => void
    tooltip?: string
  }
}

export function WorkspaceFloatingControls({
  isSidebarOpen,
  onToggleSidebar,
  newThreadButton,
  explorerButton,
}: WorkspaceFloatingControlsProps) {
  const sidebarTooltip = isSidebarOpen ? 'Collapse sidebar' : 'Open sidebar'
  const shouldShowNewThread = Boolean(newThreadButton) && !isSidebarOpen
  const shouldShowExplorer = Boolean(explorerButton) && !isSidebarOpen

  return (
    <div
      className="pointer-events-none fixed left-4 z-[70] flex items-center gap-0"
      style={{ top: 'calc(env(titlebar-area-height, 0px) + 8px)' }}
    >
      <Tooltip content={sidebarTooltip} side={isSidebarOpen ? 'right' : 'bottom'}>
        <button
          type="button"
          onClick={onToggleSidebar}
          className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-all duration-150 ease-out hover:scale-110 hover:text-foreground"
          aria-label={sidebarTooltip}
        >
          {isSidebarOpen ? (
            <X size={19} strokeWidth={2.2} className="md:hidden" />
          ) : (
            <Menu size={19} strokeWidth={2.2} className="md:hidden" />
          )}
          <PanelLeft size={18} strokeWidth={2.2} className="hidden md:block" />
        </button>
      </Tooltip>

      {newThreadButton ? (
        <div className="hidden md:block">
          <Tooltip content={newThreadButton.tooltip ?? 'New thread'} side="bottom">
            <button
              type="button"
              onClick={newThreadButton.onClick}
              className={[
                'pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-[opacity,transform,color] duration-180 ease-out hover:scale-110 hover:text-foreground',
                shouldShowNewThread ? 'opacity-100 scale-100' : 'pointer-events-none opacity-0 scale-95',
              ].join(' ')}
              aria-label={newThreadButton.tooltip ?? 'New thread'}
              aria-hidden={!shouldShowNewThread}
              tabIndex={shouldShowNewThread ? 0 : -1}
            >
              <SquarePen size={18} strokeWidth={2.2} />
            </button>
          </Tooltip>
        </div>
      ) : null}

      {explorerButton ? (
        <div className="hidden md:block">
          <Tooltip content={explorerButton.tooltip ?? 'Toggle explorer'} side="bottom">
            <button
              type="button"
              onClick={explorerButton.onClick}
              className={[
                'pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full transition-[opacity,transform,color] duration-180 ease-out hover:scale-110 hover:text-foreground',
                explorerButton.isActive ? 'text-brand' : 'text-muted-foreground',
                shouldShowExplorer ? 'opacity-100 scale-100' : 'pointer-events-none opacity-0 scale-95',
              ].join(' ')}
              aria-label={explorerButton.tooltip ?? 'Toggle explorer'}
              aria-hidden={!shouldShowExplorer}
              tabIndex={shouldShowExplorer ? 0 : -1}
            >
              <FolderTree size={18} strokeWidth={2.2} />
            </button>
          </Tooltip>
        </div>
      ) : null}
    </div>
  )
}
