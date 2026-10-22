import { useEffect, useRef, useState } from 'react'
import { showAppError } from '../ui/appNotifications'
import { BrowserZoomControls } from './BrowserZoomControls'
import type { BrowserPageControls } from './useBrowserPageActions'

interface BrowserZoomPopoverProps {
  active: boolean
  revision: number
  percent: number
  onChangeZoom: BrowserPageControls['changeZoom']
}

export function BrowserZoomPopover({ active, revision, percent, onChangeZoom }: BrowserZoomPopoverProps) {
  const [visible, setVisible] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const shownRevision = useRef(revision)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!visible) {
      setHovered(false)
      setFocused(false)
    }
  }, [visible])

  useEffect(() => {
    if (!active) {
      setVisible(false)
      shownRevision.current = revision
      return
    }
    if (shownRevision.current !== revision) {
      shownRevision.current = revision
      setVisible(true)
    }
  }, [active, revision])

  useEffect(() => {
    if (!visible || hovered || focused) {
      return
    }
    const timer = window.setTimeout(() => setVisible(false), 1500)
    return () => window.clearTimeout(timer)
  }, [visible, hovered, focused, revision])

  useEffect(() => {
    if (!visible) {
      return
    }
    const dismiss = (event: MouseEvent) => {
      if (event.target instanceof Node && !panelRef.current?.contains(event.target)) {
        setVisible(false)
      }
    }
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setVisible(false)
      }
    }
    document.addEventListener('mousedown', dismiss)
    document.addEventListener('keydown', dismissOnEscape)
    return () => {
      document.removeEventListener('mousedown', dismiss)
      document.removeEventListener('keydown', dismissOnEscape)
    }
  }, [visible])

  if (!active || !visible) {
    return null
  }

  return (
    <div
      ref={panelRef}
      className="absolute right-3 top-3 z-30 max-w-[calc(100%-1.5rem)] rounded-xl border border-border bg-surface-raised text-foreground shadow-soft"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setFocused(false)
        }
      }}
    >
      <BrowserZoomControls
        floating
        percent={percent}
        onChangeZoom={(direction) => {
          void onChangeZoom(direction).catch((error) => {
            showAppError(error, 'The webpage zoom could not be changed. Try again.', { operation: 'browser.action' })
          })
        }}
      />
    </div>
  )
}
