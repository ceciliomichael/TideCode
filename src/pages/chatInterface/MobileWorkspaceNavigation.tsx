import { Columns3, MessageSquareText, Terminal } from 'lucide-react'

export type MobileWorkspaceSurface = 'chat' | 'terminal' | 'board'

interface MobileWorkspaceNavigationProps {
  activeSurface: MobileWorkspaceSurface
  onSurfaceChange: (surface: MobileWorkspaceSurface) => void
}

const ITEMS: readonly { icon: typeof MessageSquareText; label: string; surface: MobileWorkspaceSurface }[] = [
  { icon: MessageSquareText, label: 'Chat', surface: 'chat' },
  { icon: Terminal, label: 'Terminal', surface: 'terminal' },
  { icon: Columns3, label: 'Board', surface: 'board' },
]

export function MobileWorkspaceNavigation({ activeSurface, onSurfaceChange }: MobileWorkspaceNavigationProps) {
  return (
    <nav
      className="shrink-0 border-t border-border bg-surface md:hidden"
      aria-label="Mobile workspace navigation"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="flex h-14 items-stretch px-2">
        {ITEMS.map(({ icon: Icon, label, surface }) => {
          const isActive = activeSurface === surface
          return (
            <button
              key={surface}
              type="button"
              onClick={() => onSurfaceChange(surface)}
              aria-current={isActive ? 'page' : undefined}
              className={[
                'flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-medium transition-colors',
                isActive ? 'text-foreground' : 'text-muted-foreground',
              ].join(' ')}
            >
              <Icon size={18} strokeWidth={isActive ? 2.3 : 2} />
              <span>{label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
