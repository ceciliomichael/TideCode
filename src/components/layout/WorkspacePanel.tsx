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
        'relative flex min-h-0 flex-1 flex-col overflow-hidden p-px pb-0 bg-[var(--workspace-panel-surface)] shadow-md transition-[border-radius,box-shadow,border-color] duration-300 ease-out z-10',
        'after:pointer-events-none after:absolute after:inset-0 after:z-50 after:rounded-[inherit] after:border after:border-border after:[clip-path:inset(0_0_1px_0)] after:content-[\'\']',
        showRightBorder ? '' : 'pr-0 after:border-r-0',
        isMobileLayout || !isSidebarOpen ? 'pl-0 after:border-l-0' : '',
        isMobileLayout ? 'rounded-none' : isSidebarOpen ? 'rounded-l-[28px] rounded-r-none' : 'rounded-none',
        'm-0',
      ].join(' ')}
    >
      {children}
    </main>
  )
}
