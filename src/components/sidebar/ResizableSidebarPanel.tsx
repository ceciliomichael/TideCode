import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { clampSidebarWidth } from '../../lib/sidebarSizing'
import { useIsMobileViewport } from '../../hooks/useIsMobileViewport'

export type MobileSidebarPresentation = 'overlay' | 'drawer'

interface ResizableSidebarPanelProps {
  disableSidebarTransition?: boolean
  isSidebarOpen: boolean
  mobileSidebarPresentation?: MobileSidebarPresentation
  onMobileSidebarRequestClose?: () => void
  onSidebarWidthChange: (sidebarWidth: number) => void
  onSidebarWidthPreview?: (sidebarWidth: number) => void
  onSidebarResizeStateChange?: (isResizing: boolean) => void
  sidebar: ReactNode
  sidebarWidth: number
  children: ReactNode
}

export function ResizableSidebarPanel({
  disableSidebarTransition = false,
  isSidebarOpen,
  mobileSidebarPresentation = 'overlay',
  onMobileSidebarRequestClose,
  onSidebarWidthChange,
  onSidebarWidthPreview,
  onSidebarResizeStateChange,
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
      const clampedWidth = clampSidebarWidth(nextWidth, window.innerWidth)
      updateRenderedSidebarWidth(clampedWidth)
      onSidebarWidthPreview?.(clampedWidth)
    }

    function handlePointerUp(event: PointerEvent) {
      if (dragStateRef.current?.pointerId !== event.pointerId) return

      const finalWidth = clampSidebarWidth(sidebarWidthRef.current, window.innerWidth)
      dragStateRef.current = null
      setIsResizing(false)
      onSidebarResizeStateChange?.(false)
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
      onSidebarResizeStateChange?.(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [onSidebarResizeStateChange, onSidebarWidthChange, onSidebarWidthPreview, sidebarWidth])

  useEffect(() => {
    if (
      !isMobileViewport ||
      mobileSidebarPresentation !== 'drawer' ||
      !isSidebarOpen ||
      !onMobileSidebarRequestClose
    ) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onMobileSidebarRequestClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isMobileViewport, isSidebarOpen, mobileSidebarPresentation, onMobileSidebarRequestClose])

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: renderedSidebarWidth,
    }

    setIsResizing(true)
    onSidebarResizeStateChange?.(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  const visibleSidebarWidth = isSidebarOpen ? renderedSidebarWidth : 0

  return (
    <div className="relative flex h-full min-w-0 flex-1 overflow-hidden">
      {isMobileViewport && mobileSidebarPresentation === 'drawer' ? (
        <div
          className={[
            'absolute inset-0 z-50 md:hidden transition-[visibility] duration-300',
            isSidebarOpen ? 'visible' : 'pointer-events-none invisible',
          ].join(' ')}
          aria-hidden={!isSidebarOpen}
        >
          <button
            type="button"
            aria-label="Close chat sidebar"
            onClick={onMobileSidebarRequestClose}
            className={[
              'absolute inset-0 bg-black/35 transition-opacity duration-300 ease-out',
              isSidebarOpen ? 'opacity-100' : 'opacity-0',
            ].join(' ')}
          />
          <div
            data-sidebar-root="true"
            role="dialog"
            aria-modal={isSidebarOpen ? 'true' : undefined}
            aria-label="Chat sidebar"
            className={[
              'absolute inset-y-0 left-0 flex w-[min(88vw,22rem)] max-w-full overflow-hidden bg-[var(--sidebar-panel-surface)] shadow-2xl transition-transform duration-300 ease-out',
              isSidebarOpen ? 'translate-x-0' : '-translate-x-full',
            ].join(' ')}
          >
            <div className="h-full min-w-0 flex-1">{sidebar}</div>
          </div>
        </div>
      ) : null}

      {isMobileViewport && mobileSidebarPresentation === 'overlay' && isSidebarOpen ? (
        <div
          data-sidebar-root="true"
          className="absolute inset-0 z-50 flex overflow-hidden bg-[var(--sidebar-panel-surface)]"
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
