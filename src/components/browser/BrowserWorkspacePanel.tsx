import type { BrowserUrlRequest } from '../../types/browser'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { BrowserPanel } from './BrowserPanel'
import { getMaxDiffPanelWidth, getMinDiffPanelWidth } from '../../lib/diffPanelSizing'
import { clampWorkspacePanelWidth } from '../../lib/workspacePanelSizing'
import { MIN_CHAT_PANEL_WIDTH } from '../../lib/chatPanelSizing'

interface BrowserWorkspacePanelProps {
  isInMainPanel?: boolean
  onTogglePlacement?: () => void
  urlRequests?: readonly BrowserUrlRequest[]
  onUrlRequestsConsumed?: (ids: readonly string[]) => void
  agentTab?: { tabId: string; projectPath: string; url: string } | null
  conversationId: string | null
  active: boolean
  onClose: () => void
  projectKey: string
  width: number
  onWidthChange: (width: number) => void
  onWidthCommit: (width: number) => void
}

const MAX_RETAINED_SESSIONS = 2

function clampBrowserPanelWidth(panel: HTMLDivElement, width: number) {
  const parent = panel.parentElement
  const dockContainer = parent?.closest<HTMLElement>('[data-terminal-dock-container]')
  if (dockContainer?.dataset.fixedWidth === 'true') {
    const chat = parent?.querySelector<HTMLElement>('[data-chat-panel]')
    const chatWidth = chat?.getBoundingClientRect().width ?? MIN_CHAT_PANEL_WIDTH
    const workspaceWidth = dockContainer.parentElement?.clientWidth ?? window.innerWidth
    const totalWidth = clampWorkspacePanelWidth(
      dockContainer,
      width + chatWidth,
      chatWidth + getMinDiffPanelWidth(workspaceWidth),
      chatWidth + getMaxDiffPanelWidth(workspaceWidth),
    )
    return Math.max(0, totalWidth - chatWidth)
  }

  const parentWidth = parent?.clientWidth ?? window.innerWidth
  return clampWorkspacePanelWidth(
    panel,
    width,
    getMinDiffPanelWidth(parentWidth),
    getMaxDiffPanelWidth(parentWidth),
  )
}

export function BrowserWorkspacePanel({ active, isInMainPanel = false, onTogglePlacement, onClose, projectKey, conversationId, width, onWidthChange, onWidthCommit, agentTab, urlRequests, onUrlRequestsConsumed }: BrowserWorkspacePanelProps) {
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

  // AI tabs must mount even when the user has not opened the browser panel.
  // Keep the project webview alive so the agent can use the same tab later.
  useEffect(() => {
    if (!agentTab || agentTab.projectPath.toLowerCase() !== projectKey.toLowerCase()) return
    setProjects((previous) => previous.includes(projectKey)
      ? previous
      : [...previous, projectKey].slice(-MAX_RETAINED_SESSIONS))
  }, [agentTab, projectKey])

  useLayoutEffect(() => {
    const panel = panelRef.current
    const parent = panel?.parentElement
    if (!panel || !parent || !active || isFullscreen || isInMainPanel) {
      return
    }
    const clampWidth = () => {
      const nextWidth = clampBrowserPanelWidth(panel, widthRef.current)
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
  }, [active, isFullscreen, isInMainPanel, width])

  useEffect(() => {
    function handleMove(event: PointerEvent) {
      const drag = dragRef.current
      const panel = panelRef.current
      if (!drag || !panel || event.pointerId !== drag.pointerId) {
        return
      }
      const nextWidth = clampBrowserPanelWidth(panel, drag.startWidth + drag.startX - event.clientX)
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
    if (isFullscreen || isInMainPanel || event.button !== 0) {
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

  let panelClassName = 'relative flex h-full min-h-0 min-w-0 shrink-0 flex-col overflow-hidden border-l border-border bg-background max-md:hidden'
  let panelStyle: CSSProperties | undefined = { width: `${width}px` }
  if (!active) {
    panelStyle = {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      width: `${width}px`,
      borderLeftWidth: 0,
      opacity: 0,
      pointerEvents: 'none',
    }
  } else if (isFullscreen) {
    panelClassName = 'absolute inset-0 z-40 flex min-h-0 min-w-0 flex-col overflow-hidden bg-background'
    panelStyle = undefined
  } else if (isInMainPanel) {
    panelClassName = 'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background'
    panelStyle = undefined
  }

  return (
    <div
      ref={panelRef}
      data-browser-fullscreen={isFullscreen && active ? 'true' : undefined}
      data-browser-placement={isInMainPanel ? 'main' : 'side'}
      className={panelClassName}
      style={panelStyle}
      aria-hidden={!active}
    >
      {active && !isFullscreen && !isInMainPanel ? (
        <div role="separator" aria-label="Resize browser panel" aria-orientation="vertical" onPointerDown={startResize} className="absolute inset-y-0 left-0 z-20 w-3 -translate-x-1/2 cursor-col-resize" />
      ) : null}
      {projects.map((key) => (
        <div
          key={key}
          className={active && key === projectKey
            ? 'relative flex min-h-0 min-w-0 flex-1 flex-col'
            : 'pointer-events-none absolute inset-0 flex min-h-0 min-w-0 flex-col opacity-0'}
          aria-hidden={!(active && key === projectKey)}
        >
          <BrowserPanel
            isInMainPanel={isInMainPanel}
            onTogglePlacement={onTogglePlacement ? () => {
              setIsFullscreen(false)
              onTogglePlacement()
            } : undefined}
            urlRequests={key === projectKey ? urlRequests : undefined}
            onUrlRequestsConsumed={onUrlRequestsConsumed}
            agentTab={agentTab?.projectPath.toLowerCase() === key.toLowerCase() ? agentTab : null}
            conversationId={conversationId}
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
