import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { clampSidebarWidth } from '../../lib/sidebarSizing'
import { useIsMobileViewport } from '../../hooks/useIsMobileViewport'

interface ResizableSidebarPanelProps {
  disableSidebarTransition?: boolean
  isSidebarOpen: boolean
  mobileSidebarBottomInset?: string
  onSidebarWidthChange: (sidebarWidth: number) => void
  sidebar: ReactNode
  sidebarWidth: number
  children: ReactNode
}

export function ResizableSidebarPanel({
  disableSidebarTransition = false,
  isSidebarOpen,
  mobileSidebarBottomInset,
  onSidebarWidthChange,
  sidebar,
  sidebarWidth,
  children,
}: ResizableSidebarPanelProps) {
  const isMobileViewport = useIsMobileViewport()
  const [renderedSidebarWidth, setRenderedSidebarWidth] = useState(() =>
    typeof window === 'undefined' ? sidebarWidth : clampSidebarWidth(sidebarWidth, window.innerWidth),
  )
  const [isResizing, setIsResizing] = useState(false)
  const dragStateRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null)
  const sidebarWidthRef = useRef(renderedSidebarWidth)

  function updateRenderedSidebarWidth(nextWidth: number) {
    sidebarWidthRef.current = nextWidth
    setRenderedSidebarWidth(nextWidth)
  }

  useLayoutEffect(() => {
    function handleWindowResize() {
      const widthToClamp = dragStateRef.current ? sidebarWidthRef.current : sidebarWidth
      updateRenderedSidebarWidth(clampSidebarWidth(widthToClamp, window.innerWidth))
    }

    handleWindowResize()
    window.addEventListener('resize', handleWindowResize)
    return () => {
      window.removeEventListener('resize', handleWindowResize)
    }
  }, [sidebarWidth])

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const dragState = dragStateRef.current
      if (!dragState) return

      const nextWidth = dragState.startWidth + (event.clientX - dragState.startX)
      updateRenderedSidebarWidth(clampSidebarWidth(nextWidth, window.innerWidth))
    }

    function handlePointerUp(event: PointerEvent) {
      if (dragStateRef.current?.pointerId !== event.pointerId) return

      const finalWidth = clampSidebarWidth(sidebarWidthRef.current, window.innerWidth)
      dragStateRef.current = null
      setIsResizing(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''

      if (finalWidth !== sidebarWidth) {
        onSidebarWidthChange(finalWidth)
      }
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      setIsResizing(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [onSidebarWidthChange, sidebarWidth])

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: renderedSidebarWidth,
    }

    setIsResizing(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  const visibleSidebarWidth = isSidebarOpen ? renderedSidebarWidth : 0

  return (
    <div className="relative flex h-full min-w-0 flex-1 overflow-hidden">
      {isMobileViewport && isSidebarOpen ? (
        <div
          data-sidebar-root="true"
          className="absolute inset-x-0 top-0 z-50 flex overflow-hidden bg-[var(--sidebar-panel-surface)]"
          style={{ bottom: mobileSidebarBottomInset ?? 0 }}
        >
          <div className="h-full min-w-0 flex-1">{sidebar}</div>
        </div>
      ) : null}

      {!isMobileViewport ? (
        <div
          data-sidebar-root="true"
          className={[
            'flex h-full shrink-0 overflow-hidden',
            disableSidebarTransition || isResizing ? '' : 'transition-[width,opacity] duration-300 ease-out',
            isSidebarOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
          ].join(' ')}
          style={{ width: `${visibleSidebarWidth}px` }}
          aria-hidden={!isSidebarOpen}
        >
          <div className="h-full shrink-0" style={{ width: `${renderedSidebarWidth}px` }}>
            {sidebar}
          </div>
        </div>
      ) : null}

      <div className="relative z-10 flex min-w-0 flex-1">
        {!isMobileViewport ? (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            onPointerDown={handlePointerDown}
            className={[
              'absolute inset-y-0 left-0 z-20 w-3 -translate-x-1/2 cursor-col-resize',
              isSidebarOpen ? '' : 'pointer-events-none opacity-0',
            ].join(' ')}
          />
        ) : null}
        {children}
      </div>
    </div>
  )
}
