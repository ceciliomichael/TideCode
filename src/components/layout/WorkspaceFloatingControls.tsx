import { FolderTree, Menu, PanelLeft, SquarePen, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Tooltip } from '../Tooltip'

interface WorkspaceFloatingControlsProps {
  hideMobile?: boolean
  isSidebarOpen: boolean
  isSidebarResizing?: boolean
  mobileTitle?: string
  onToggleSidebar: () => void
  sidebarWidth?: number
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
  hideMobile = false,
  isSidebarOpen,
  isSidebarResizing = false,
  mobileTitle,
  onToggleSidebar,
  sidebarWidth,
  newThreadButton,
  explorerButton,
}: WorkspaceFloatingControlsProps) {
  const sidebarTooltip = isSidebarOpen ? 'Collapse sidebar' : 'Open sidebar'
  const shouldShowNewThread = Boolean(newThreadButton)
  const shouldShowExplorer = Boolean(explorerButton) && !isSidebarOpen
  const previousSidebarOpenRef = useRef(isSidebarOpen)
  const [isSidebarTransitioning, setIsSidebarTransitioning] = useState(false)

  useEffect(() => {
    if (previousSidebarOpenRef.current === isSidebarOpen) {
      return
    }

    previousSidebarOpenRef.current = isSidebarOpen
    setIsSidebarTransitioning(true)
    const timeoutId = window.setTimeout(() => setIsSidebarTransitioning(false), 300)
    return () => window.clearTimeout(timeoutId)
  }, [isSidebarOpen])

  const sidebarControlIsOpenStyle = isSidebarOpen || isSidebarTransitioning

  return (
    <div
      className={[
        'pointer-events-none fixed left-4 z-[70] items-center gap-0',
        hideMobile ? 'hidden md:flex' : 'flex',
      ].join(' ')}
      style={{ top: 'calc(env(titlebar-area-height, 0px) + 8px)' }}
    >
      <Tooltip content={sidebarTooltip} side={isSidebarOpen ? 'right' : 'bottom'}>
        <button
          type="button"
          onClick={onToggleSidebar}
          className={[
            'pointer-events-auto flex h-10 w-10 items-center justify-center text-muted-foreground transition-all duration-150 ease-out',
            isSidebarTransitioning ? '' : 'hover:scale-110 hover:text-foreground',
            sidebarControlIsOpenStyle
              ? isSidebarTransitioning
                ? 'rounded-xl'
                : 'rounded-xl hover:bg-[var(--sidebar-hover-surface)]'
              : 'rounded-full',
          ].join(' ')}
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

      {mobileTitle ? (
        <span
          data-mobile-page-title="true"
          className="pointer-events-none max-w-[calc(100vw-5rem)] truncate pl-1 pr-3 text-sm font-semibold text-foreground md:hidden"
        >
          {mobileTitle}
        </span>
      ) : null}

      {newThreadButton ? (
        <div
          className={[
            'hidden md:absolute md:block',
            isSidebarResizing ? 'transition-none' : 'transition-[left] duration-300 ease-out',
          ].join(' ')}
          style={{
            left: `${isSidebarOpen && sidebarWidth ? Math.max(sidebarWidth - 80, 0) : 40}px`,
          }}
        >
          <Tooltip
            content={newThreadButton.tooltip ?? 'Choose a project for a new thread'}
            side={isSidebarOpen ? 'left' : 'bottom'}
          >
            <button
              type="button"
              onClick={newThreadButton.onClick}
              className={[
                'pointer-events-auto flex h-10 w-10 items-center justify-center text-muted-foreground transition-[opacity,transform,color] duration-180 ease-out',
                isSidebarTransitioning ? 'transition-none' : 'hover:scale-110 hover:text-foreground',
                sidebarControlIsOpenStyle
                  ? isSidebarTransitioning
                    ? 'rounded-xl'
                    : 'rounded-xl hover:bg-[var(--sidebar-hover-surface)]'
                  : 'rounded-full',
                shouldShowNewThread ? 'opacity-100 scale-100' : 'pointer-events-none opacity-0 scale-95',
              ].join(' ')}
              aria-label={newThreadButton.tooltip ?? 'Choose a project for a new thread'}
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
