import type { ReactNode } from 'react'

interface WorkspacePanelProps {
  isMobileLayout?: boolean
  isSidebarOpen: boolean
  showRightBorder?: boolean
  children: ReactNode
}

export function WorkspacePanel({
  isMobileLayout = false,
  isSidebarOpen,
  showRightBorder = true,
  children,
}: WorkspacePanelProps) {
  return (
    <main
      className={[
        'relative flex min-h-0 flex-1 flex-col overflow-hidden border border-border bg-[var(--workspace-panel-surface)] shadow-md transition-[border-radius,box-shadow,border-color] duration-300 ease-out z-10',
        showRightBorder ? '' : 'border-r-0',
        isMobileLayout || !isSidebarOpen ? 'border-l-0' : '',
        isMobileLayout ? 'rounded-none' : isSidebarOpen ? 'rounded-l-[28px] rounded-r-none' : 'rounded-none',
        'm-0',
      ].join(' ')}
    >
      {children}
    </main>
  )
}
