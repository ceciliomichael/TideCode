import type { ReactNode } from 'react'
import { Columns3, PanelLeft, SquarePen, Terminal } from 'lucide-react'

export type MobileWorkspaceSurface = 'chat' | 'terminal' | 'board'

export interface MobileWorkspaceControlsProps {
  activeSurface: MobileWorkspaceSurface
  isMenuOpen: boolean
  onCreateConversation: () => void
  onSurfaceChange: (surface: MobileWorkspaceSurface) => void
  onToggleMenu: () => void
}

interface SegmentedIconButtonProps {
  active?: boolean
  ariaLabel: string
  children: ReactNode
  onClick: () => void
}

function SegmentedIconButton({
  active = false,
  ariaLabel,
  children,
  onClick,
}: SegmentedIconButtonProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={active || undefined}
      onClick={onClick}
      className={[
        'flex h-8 w-9 shrink-0 items-center justify-center rounded-lg transition-[background-color,color,transform] duration-150 active:scale-95',
        active
          ? 'bg-[var(--sidebar-hover-surface)] text-foreground'
          : 'text-muted-foreground hover:bg-[var(--sidebar-hover-surface)] hover:text-foreground',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

export function MobileWorkspaceControls({
  activeSurface,
  isMenuOpen,
  onCreateConversation,
  onSurfaceChange,
  onToggleMenu,
}: MobileWorkspaceControlsProps) {
  const handleTerminalClick = () => {
    onSurfaceChange(activeSurface === 'terminal' ? 'chat' : 'terminal')
  }

  const handleBoardClick = () => {
    onSurfaceChange(activeSurface === 'board' ? 'chat' : 'board')
  }

  return (
    <div className="flex w-full items-center justify-between gap-3" aria-label="Mobile workspace controls">
      <div className="flex shrink-0 items-center rounded-xl border border-border bg-[var(--sidebar-raised-surface)] p-1">
        <button
          type="button"
          onClick={onToggleMenu}
          aria-label={isMenuOpen ? 'Close chat sidebar' : 'Open chat sidebar'}
          aria-expanded={isMenuOpen}
          className={[
            'flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-[background-color,color,transform] duration-150 active:scale-95',
            isMenuOpen
              ? 'bg-[var(--sidebar-hover-surface)] text-foreground'
              : 'hover:bg-[var(--sidebar-hover-surface)] hover:text-foreground',
          ].join(' ')}
        >
          <PanelLeft size={18} strokeWidth={2.2} aria-hidden="true" />
        </button>
      </div>

      <div className="flex shrink-0 items-center rounded-xl border border-border bg-[var(--sidebar-raised-surface)] p-1">
        <SegmentedIconButton ariaLabel="Start new chat" onClick={onCreateConversation}>
          <SquarePen size={18} strokeWidth={2.2} aria-hidden="true" />
        </SegmentedIconButton>
        <SegmentedIconButton
          active={activeSurface === 'terminal'}
          ariaLabel={activeSurface === 'terminal' ? 'Return to chat' : 'Open terminal'}
          onClick={handleTerminalClick}
        >
          <Terminal size={18} strokeWidth={2.2} aria-hidden="true" />
        </SegmentedIconButton>
        <SegmentedIconButton
          active={activeSurface === 'board'}
          ariaLabel={activeSurface === 'board' ? 'Return to chat' : 'Open Kanban board'}
          onClick={handleBoardClick}
        >
          <Columns3 size={18} strokeWidth={2.2} aria-hidden="true" />
        </SegmentedIconButton>
      </div>
    </div>
  )
}

export function MobileWorkspaceHeader(props: MobileWorkspaceControlsProps) {
  return (
    <header className="relative z-30 flex h-14 shrink-0 items-center bg-[var(--workspace-panel-surface)] px-4 md:hidden">
      <MobileWorkspaceControls {...props} />
    </header>
  )
}
