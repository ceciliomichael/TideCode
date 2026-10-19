import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { BrowserPanel } from './BrowserPanel'
import { MAX_DIFF_PANEL_WIDTH, MIN_DIFF_PANEL_WIDTH } from '../../lib/diffPanelSizing'
import { clampWorkspacePanelWidth } from '../../lib/workspacePanelSizing'

interface BrowserWorkspacePanelProps {
  active: boolean
  onClose: () => void
  projectKey: string
  width: number
  onWidthChange: (width: number) => void
  onWidthCommit: (width: number) => void
}

const MAX_RETAINED_SESSIONS = 2

export function BrowserWorkspacePanel({ active, onClose, projectKey, width, onWidthChange, onWidthCommit }: BrowserWorkspacePanelProps) {
  const [projects, setProjects] = useState<string[]>([])
  const [isFullscreen, setIsFullscreen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null)
  const widthRef = useRef(width)
  const callbacksRef = useRef({ onWidthChange, onWidthCommit })
  callbacksRef.current = { onWidthChange, onWidthCommit }
  widthRef.current = width

  useEffect(() => {
    if (!active) {
      setIsFullscreen(false)
      return
    }
    setProjects((previous) => {
      if (previous.at(-1) === projectKey) {
        return previous
      }
      return [...previous.filter((key) => key !== projectKey), projectKey].slice(-MAX_RETAINED_SESSIONS)
    })
  }, [active, projectKey])

  useLayoutEffect(() => {
    const panel = panelRef.current
    const parent = panel?.parentElement
    if (!panel || !parent || !active || isFullscreen) {
      return
    }
    const clampWidth = () => {
      const nextWidth = clampWorkspacePanelWidth(panel, widthRef.current, MIN_DIFF_PANEL_WIDTH, MAX_DIFF_PANEL_WIDTH)
      panel.style.width = `${nextWidth}px`
      if (nextWidth !== widthRef.current) {
        widthRef.current = nextWidth
        callbacksRef.current.onWidthChange(nextWidth)
      }
    }
    clampWidth()
    const observer = new ResizeObserver(clampWidth)
    observer.observe(parent)
    const chat = parent.querySelector('[data-chat-panel]')
    if (chat) {
      observer.observe(chat)
    }
    return () => observer.disconnect()
  }, [active, isFullscreen, width])

  useEffect(() => {
    function handleMove(event: PointerEvent) {
      const drag = dragRef.current
      const panel = panelRef.current
      if (!drag || !panel || event.pointerId !== drag.pointerId) {
        return
      }
      const nextWidth = clampWorkspacePanelWidth(panel, drag.startWidth + drag.startX - event.clientX, MIN_DIFF_PANEL_WIDTH, MAX_DIFF_PANEL_WIDTH)
      widthRef.current = nextWidth
      panel.style.width = `${nextWidth}px`
      callbacksRef.current.onWidthChange(nextWidth)
    }
    function handleEnd(event: PointerEvent) {
      if (dragRef.current?.pointerId !== event.pointerId) {
        return
      }
      dragRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      callbacksRef.current.onWidthCommit(widthRef.current)
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleEnd)
    window.addEventListener('pointercancel', handleEnd)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleEnd)
      window.removeEventListener('pointercancel', handleEnd)
      if (dragRef.current) {
        dragRef.current = null
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
  }, [active])

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (isFullscreen || event.button !== 0) {
      return
    }
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: panelRef.current?.getBoundingClientRect().width ?? width,
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  function closeProject(key: string) {
    setProjects((previous) => previous.filter((project) => project !== key))
    setIsFullscreen(false)
    onClose()
  }

  return (
    <div
      ref={panelRef}
      className={isFullscreen && active
        ? 'absolute inset-0 z-40 flex min-h-0 min-w-0 flex-col overflow-hidden border-l border-border bg-background'
        : 'relative flex h-full min-h-0 min-w-0 shrink-0 flex-col overflow-hidden border-l border-border bg-background max-md:hidden'}
      style={isFullscreen && active ? undefined : { width: active ? `${width}px` : 0, borderLeftWidth: active ? undefined : 0, visibility: active ? undefined : 'hidden' }}
      aria-hidden={!active}
    >
      {active && !isFullscreen ? (
        <div role="separator" aria-label="Resize browser panel" aria-orientation="vertical" onPointerDown={startResize} className="absolute inset-y-0 left-0 z-20 w-3 -translate-x-1/2 cursor-col-resize" />
      ) : null}
      {projects.map((key) => (
        <div key={key} className={active && key === projectKey ? 'flex min-h-0 min-w-0 flex-1 flex-col' : 'hidden'}>
          <BrowserPanel
            active={active && key === projectKey}
            projectKey={key}
            onClose={() => closeProject(key)}
            isFullScreen={isFullscreen}
            onToggleFullScreen={() => setIsFullscreen((current) => !current)}
          />
        </div>
      ))}
    </div>
  )
}
