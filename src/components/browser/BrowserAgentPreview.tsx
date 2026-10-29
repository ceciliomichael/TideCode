import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Globe2, Home, RefreshCw, Search } from 'lucide-react'
import { Tooltip } from '../Tooltip'
import type { AgentBrowserCursor } from '../../types/browser'

interface AgentFrame {
  tabId: string
  projectPath: string
  url: string
  width: number
  height: number
  cursor: AgentBrowserCursor | null
  imageDataUrl: string
}

export function BrowserAgentPreview({ tabId, projectPath, active }: { tabId: string; projectPath: string; active: boolean }) {
  const [frame, setFrame] = useState<AgentFrame | null>(null)
  const [previousCursor, setPreviousCursor] = useState<AgentBrowserCursor | null>(null)
  const currentCursor = useRef<AgentBrowserCursor | null>(null)
  useEffect(() => {
    if (!active) return
    const input = { tabId, projectPath }
    void window.tidecodeBrowserPageActions.setAgentPreviewVisible({ ...input, visible: true }).catch(console.error)
    return () => {
      void window.tidecodeBrowserPageActions.setAgentPreviewVisible({ ...input, visible: false }).catch(() => undefined)
    }
  }, [active, tabId, projectPath])
  useEffect(() => {
    const api = window.tidecodeBrowserPageActions
    if (!api?.onAgentFrame) return
    const cached = api.getAgentFrame(tabId)
    if (cached?.projectPath.toLowerCase() === projectPath.toLowerCase()) {
      currentCursor.current = cached.cursor
      setFrame(cached)
    }
    const offFrame = api.onAgentFrame((next) => {
      if (next.tabId === tabId && next.projectPath.toLowerCase() === projectPath.toLowerCase()) {
        currentCursor.current = next.cursor
        setFrame(next)
      }
    })
    const offCursor = api.onAgentCursor((next) => {
      if (next.tabId === tabId && next.projectPath.toLowerCase() === projectPath.toLowerCase()) {
        const previous = currentCursor.current
        if (previous && (previous.x !== next.cursor.x || previous.y !== next.cursor.y)) {
          setPreviousCursor(previous)
        }
        currentCursor.current = next.cursor
        setFrame((current) => current ? { ...current, cursor: next.cursor } : current)
      }
    })
    return () => {
      offFrame()
      offCursor()
      currentCursor.current = null
    }
  }, [tabId, projectPath])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border px-2">
        {([
          [ArrowLeft, 'Back'],
          [ArrowRight, 'Forward'],
          [RefreshCw, 'Reload'],
          [Home, 'Home'],
        ] as const).map(([Icon, label]) => (
          <Tooltip key={label} content="Navigation is controlled by the AI" side="bottom" noWrap>
            <button
              type="button"
              aria-label={label}
              aria-disabled="true"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground opacity-35"
            >
              <Icon size={16} />
            </button>
          </Tooltip>
        ))}
        <div className="relative ml-1 flex min-w-0 flex-1 items-center">
          <Globe2 size={15} className="pointer-events-none absolute left-3 text-muted-foreground" />
          <Tooltip content="AI-owned browser address (read-only). Select to copy the URL." side="bottom" fullWidthTrigger>
            <input
            type="text"
            readOnly
            value={frame?.url ?? ''}
            aria-label="AI browser address"
            placeholder="AI browser address"
            spellCheck={false}
            className="h-8 w-full rounded-lg border border-border bg-muted/40 pl-9 pr-10 text-sm text-foreground shadow-none outline-none placeholder:text-muted-foreground focus:border-border focus:bg-muted/40 focus:outline-none focus:ring-0"
            onFocus={(event) => event.currentTarget.select()}
            />
          </Tooltip>
          <Search size={14} className="pointer-events-none absolute right-3 text-muted-foreground" />
        </div>
      </div>
      {frame ? (
        <div className="relative min-h-0 flex-1 overflow-hidden bg-white">
          <img src={frame.imageDataUrl} alt="AI browser viewport" draggable={false}
            className="absolute inset-0 h-full w-full select-none object-contain" />
          {frame.cursor ? (
            <svg viewBox={`0 0 ${frame.width} ${frame.height}`} preserveAspectRatio="xMidYMid meet"
              className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
              <g transform={`translate(${frame.cursor.x} ${frame.cursor.y})`}>
                {previousCursor
                  && frame.cursor.motionRevision
                  && (previousCursor.x !== frame.cursor.x || previousCursor.y !== frame.cursor.y) ? (
                    <animateTransform
                      key={frame.cursor.motionRevision}
                      attributeName="transform"
                      type="translate"
                      from={`${previousCursor.x} ${previousCursor.y}`}
                      to={`${frame.cursor.x} ${frame.cursor.y}`}
                      dur="0.18s"
                      fill="freeze"
                    />
                  ) : null}
                {frame.cursor.kind === 'text' || frame.cursor.kind === 'vertical-text' ? (
                  <path d="M-5 0 H5 M0 0 V25 M-5 25 H5" stroke="#171717" strokeWidth="3" strokeLinecap="round" fill="none" />
                ) : ['wait', 'progress'].includes(frame.cursor.kind ?? '') ? (
                  <g>
                    <circle cx="8" cy="8" r="7" stroke="#171717" strokeWidth="3" strokeDasharray="15 10" fill="none" />
                    <animateTransform attributeName="transform" type="rotate" from="0 8 8" to="360 8 8" dur=".9s" repeatCount="indefinite" />
                  </g>
                ) : ['crosshair'].includes(frame.cursor.kind ?? '') ? (
                  <path d="M0 -9 V9 M-9 0 H9" stroke="#171717" strokeWidth="2.5" fill="none" />
                ) : frame.cursor.kind === 'none' ? (
                  <circle cx="0" cy="0" r="4" fill="#16a34a" stroke="white" strokeWidth="1.5" />
                ) : ['not-allowed', 'no-drop'].includes(frame.cursor.kind ?? '') ? (
                  <g stroke="#171717" strokeWidth="2.5" fill="none"><circle r="10" cx="8" cy="8" /><path d="M1 1 L15 15" /></g>
                ) : ['pointer', 'grab', 'grabbing'].includes(frame.cursor.kind ?? '') ? (
                  <path d="M5 29 L0 18 Q-2 14 1 12 Q4 10 7 15 L7 3 Q7 -2 11 -2 Q15 -2 15 3 V13 Q17 9 20 10 Q22 11 22 14 Q25 10 28 12 Q31 14 31 17 L31 24 Q31 32 25 34 H13 Q9 34 5 29 Z" fill="#171717" stroke="white" strokeWidth="2" />
                ) : ['move', 'all-scroll'].includes(frame.cursor.kind ?? '') ? (
                  <g stroke="#171717" strokeWidth="2.5" fill="none" strokeLinecap="round">
                    <path d="M8 -10 V22 M-10 6 H26 M3 -5 L8 -10 L13 -5 M3 17 L8 22 L13 17 M-5 1 L-10 6 L-5 11 M21 1 L26 6 L21 11" />
                  </g>
                ) : /resize|col-resize|row-resize/u.test(frame.cursor.kind ?? '') ? (
                  <path d={/^(n|s|ns|row)-resize$/u.test(frame.cursor.kind ?? '')
                    ? 'M8 -9 V25 M3 -4 L8 -9 L13 -4 M3 20 L8 25 L13 20'
                    : /^(ne|sw|nw|se|nesw|nwse)-resize$/u.test(frame.cursor.kind ?? '')
                      ? 'M-7 23 L23 -7 M-7 16 L-7 23 L0 23 M16 -7 L23 -7 L23 0'
                      : 'M-9 8 H25 M-4 3 L-9 8 L-4 13 M20 3 L25 8 L20 13'} stroke="#171717" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
                ) : ['zoom-in', 'zoom-out'].includes(frame.cursor.kind ?? '') ? (
                  <g fill="none" stroke="#171717" strokeWidth="2.5" strokeLinecap="round">
                    <circle cx="8" cy="8" r="9" />
                    <path d="M15 15 L26 26 M3 8 H13" />
                    {frame.cursor.kind === 'zoom-in' ? <path d="M8 3 V13" /> : null}
                  </g>
                ) : frame.cursor.kind === 'cell' ? (
                  <g fill="none" stroke="#171717" strokeWidth="2">
                    <rect x="0" y="0" width="22" height="22" />
                    <path d="M7 0 V22 M15 0 V22 M0 7 H22 M0 15 H22" />
                  </g>
                ) : ['copy', 'alias', 'help', 'context-menu'].includes(frame.cursor.kind ?? '') ? (
                  <g>
                    <path d="M0 0 L0 25 L6 19 L12 31 L18 28 L12 16 L23 16 Z"
                      fill="#171717" stroke="white" strokeWidth="2" strokeLinejoin="round" />
                    <text x="22" y="29" fill="#171717" stroke="white" strokeWidth=".5" fontSize="15" fontWeight="bold">
                      {frame.cursor.kind === 'copy' ? '+' : frame.cursor.kind === 'alias' ? '↗' : frame.cursor.kind === 'help' ? '?' : '≡'}
                    </text>
                  </g>
                ) : (
                  <path d="M0 0 L0 25 L6 19 L12 31 L18 28 L12 16 L23 16 Z"
                    fill="#171717" stroke="white" strokeWidth="2" strokeLinejoin="round" />
                )}
                <circle cx="23" cy="27" r="5" fill="#16a34a" stroke="white" strokeWidth="1.5" />
                {frame.cursor.effect === 'click' ? (
                  <circle key={frame.cursor.revision} cx="0" cy="0" r="12" fill="none" stroke="#16a34a" strokeWidth="2" opacity=".7">
                    <animate attributeName="r" from="3" to="23" dur=".3s" fill="freeze" />
                    <animate attributeName="opacity" from=".8" to="0" dur=".3s" fill="freeze" />
                  </circle>
                ) : null}
              </g>
            </svg>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Waiting for the AI browser preview.</p>
      )}
    </div>
  )
}
