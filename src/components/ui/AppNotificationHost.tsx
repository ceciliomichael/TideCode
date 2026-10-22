import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AppNoticeSurface } from './AppNoticeSurface'
import { ERROR_TOAST_DURATION_MS, NOTIFICATION_EVENT, type AppNotification } from './appNotifications'

function TimedNotification({ notice, onDismiss }: { notice: AppNotification; onDismiss: (id: number) => void }) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const remainingRef = useRef(ERROR_TOAST_DURATION_MS)
  const close = useCallback(() => onDismiss(notice.id), [notice.id, onDismiss])

  useEffect(() => {
    if (hovered || focused) {
      return
    }
    const startedAt = performance.now()
    const timeout = window.setTimeout(close, remainingRef.current)
    return () => {
      window.clearTimeout(timeout)
      remainingRef.current = Math.max(0, remainingRef.current - (performance.now() - startedAt))
    }
  }, [close, hovered, focused])

  return (
    <AppNoticeSurface
      mode="toast"
      title={notice.feedback.title}
      feedback={notice.feedback}
      onDismiss={close}
      action={notice.action}
      ariaLabel="Application error notification"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setFocused(false)
        }
      }}
    />
  )
}

export function AppNotificationHost() {
  const [notices, setNotices] = useState<AppNotification[]>([])
  const dismiss = useCallback((id: number) => setNotices((current) => current.filter((notice) => notice.id !== id)), [])

  useEffect(() => {
    function receive(event: Event) {
      const notice = (event as CustomEvent<AppNotification>).detail
      setNotices((current) => [...current, notice].slice(-3))
    }
    window.addEventListener(NOTIFICATION_EVENT, receive)
    return () => window.removeEventListener(NOTIFICATION_EVENT, receive)
  }, [])

  if (notices.length === 0) {
    return null
  }
  return createPortal(
    <div className="pointer-events-none fixed right-3 top-14 z-[200] flex max-w-[calc(100vw-1.5rem)] flex-col items-end gap-2" aria-label="Application notifications">
      {notices.map((notice) => (
        <div key={notice.id} className="pointer-events-auto">
          <TimedNotification notice={notice} onDismiss={dismiss} />
        </div>
      ))}
    </div>,
    document.body,
  )
}
