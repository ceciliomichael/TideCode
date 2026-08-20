import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ResizableSidebarPanel, type MobileSidebarPresentation } from '../sidebar/ResizableSidebarPanel'
import { BrandWordmark } from '../branding/BrandWordmark'
import { isRemoteBrowserRuntime } from '../../remote/webBridge'
import { useIsMobileViewport } from '../../hooks/useIsMobileViewport'

interface MobileVisualViewportFrame {
  height: number
  offsetTop: number
}

function isTextEntryElement(element: Element | null) {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    (element instanceof HTMLElement && element.isContentEditable)
  )
}

interface AppWorkspaceShellProps {
  disableSidebarTransition?: boolean
  isSidebarOpen: boolean
  mobileSidebarPresentation?: MobileSidebarPresentation
  onMobileSidebarRequestClose?: () => void
  onSidebarWidthChange: (sidebarWidth: number) => void
  sidebar: ReactNode
  sidebarWidth: number
  floatingControls?: ReactNode
  children: ReactNode
}

export function AppWorkspaceShell({
  disableSidebarTransition = false,
  isSidebarOpen,
  mobileSidebarPresentation,
  onMobileSidebarRequestClose,
  onSidebarWidthChange,
  sidebar,
  sidebarWidth,
  floatingControls,
  children,
}: AppWorkspaceShellProps) {
  const isRemoteBrowser = isRemoteBrowserRuntime()
  const isMobileViewport = useIsMobileViewport()
  const shellRef = useRef<HTMLDivElement | null>(null)
  const [mobileVisualViewportFrame, setMobileVisualViewportFrame] = useState<MobileVisualViewportFrame | null>(null)

  useLayoutEffect(() => {
    if (!isMobileViewport || !window.visualViewport) {
      setMobileVisualViewportFrame(null)
      return
    }

    const visualViewport = window.visualViewport
    const syncVisualViewport = (force = false) => {
      const activeElement = document.activeElement
      const shellElement = shellRef.current
      const textEntryIsOutsideWorkspace =
        !force &&
        shellElement !== null &&
        isTextEntryElement(activeElement) &&
        !shellElement.contains(activeElement)

      if (textEntryIsOutsideWorkspace) {
        return
      }

      const nextFrame = {
        height: Math.max(1, Math.round(visualViewport.height)),
        offsetTop: Math.max(0, Math.round(visualViewport.offsetTop)),
      }
      setMobileVisualViewportFrame((currentFrame) =>
        currentFrame?.height === nextFrame.height && currentFrame.offsetTop === nextFrame.offsetTop
          ? currentFrame
          : nextFrame,
      )
    }
    const handleVisualViewportChange = () => syncVisualViewport()
    const handleOrientationChange = () => syncVisualViewport(true)

    syncVisualViewport()
    visualViewport.addEventListener('resize', handleVisualViewportChange)
    visualViewport.addEventListener('scroll', handleVisualViewportChange)
    window.addEventListener('resize', handleVisualViewportChange)
    window.addEventListener('orientationchange', handleOrientationChange)

    return () => {
      visualViewport.removeEventListener('resize', handleVisualViewportChange)
      visualViewport.removeEventListener('scroll', handleVisualViewportChange)
      window.removeEventListener('resize', handleVisualViewportChange)
      window.removeEventListener('orientationchange', handleOrientationChange)
    }
  }, [isMobileViewport])

  return (
    <div
      ref={shellRef}
      data-mobile-visual-viewport={isMobileViewport ? 'true' : undefined}
      className="relative flex h-screen h-[100dvh] overflow-hidden bg-[var(--workspace-shell-surface)]"
      style={{
        paddingTop: 'env(titlebar-area-height, 0px)',
        ...(mobileVisualViewportFrame
          ? {
              height: `${mobileVisualViewportFrame.height}px`,
              top: `${mobileVisualViewportFrame.offsetTop}px`,
            }
          : {}),
      }}
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
        mobileSidebarPresentation={mobileSidebarPresentation}
        onMobileSidebarRequestClose={onMobileSidebarRequestClose}
        onSidebarWidthChange={onSidebarWidthChange}
        sidebar={sidebar}
        sidebarWidth={sidebarWidth}
      >
        {children}
      </ResizableSidebarPanel>
    </div>
  )
}
