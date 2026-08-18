import type { ReactNode } from 'react'
import { ResizableSidebarPanel } from '../sidebar/ResizableSidebarPanel'
import { BrandWordmark } from '../branding/BrandWordmark'
import { isRemoteBrowserRuntime } from '../../remote/webBridge'

interface AppWorkspaceShellProps {
  disableSidebarTransition?: boolean
  isSidebarOpen: boolean
  onSidebarWidthChange: (sidebarWidth: number) => void
  sidebar: ReactNode
  sidebarWidth: number
  floatingControls?: ReactNode
  children: ReactNode
}

export function AppWorkspaceShell({
  disableSidebarTransition = false,
  isSidebarOpen,
  onSidebarWidthChange,
  sidebar,
  sidebarWidth,
  floatingControls,
  children,
}: AppWorkspaceShellProps) {
  const isRemoteBrowser = isRemoteBrowserRuntime()

  return (
    <div
      className="relative flex h-screen h-[100dvh] overflow-hidden bg-[var(--workspace-shell-surface)]"
      style={{ paddingTop: 'env(titlebar-area-height, 0px)' }}
    >
      {!isRemoteBrowser ? (
        <div
          className="app-drag-region pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center bg-[var(--titlebar-surface)] px-3 text-sm font-medium text-foreground/75"
          style={{ height: 'env(titlebar-area-height, 0px)' }}
        >
          <div className="flex items-center gap-2">
            <BrandWordmark className="h-7 w-[107px] text-brand" />
          </div>
        </div>
      ) : null}

      {floatingControls ? <div className="relative z-[70]">{floatingControls}</div> : null}

      <ResizableSidebarPanel
        disableSidebarTransition={disableSidebarTransition}
        isSidebarOpen={isSidebarOpen}
        onSidebarWidthChange={onSidebarWidthChange}
        sidebar={sidebar}
        sidebarWidth={sidebarWidth}
      >
        {children}
      </ResizableSidebarPanel>
    </div>
  )
}
