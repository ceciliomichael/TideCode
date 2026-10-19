import { X } from 'lucide-react'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type {
  BrowserScreenshot,
  BrowserScreenshotAction,
} from '../../types/browser'

interface BrowserScreenshotToastProps {
  containerRef: RefObject<HTMLDivElement | null>
  screenshot: BrowserScreenshot
  onClose: () => void
}

export function BrowserScreenshotToast({
  containerRef,
  screenshot,
  onClose,
}: BrowserScreenshotToastProps) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [pendingActions, setPendingActions] = useState<
    BrowserScreenshotAction[]
  >([])
  const [copied, setCopied] = useState({ copyPath: false, copyImage: false })
  const copyTimersRef = useRef<
    Partial<Record<'copyPath' | 'copyImage', number>>
  >({})
  const [error, setError] = useState('')
  const runningRef = useRef(new Set<BrowserScreenshotAction>())
  const remainingDurationRef = useRef(3000)
  const paused =
    hovered || focused || pendingActions.length > 0 || Boolean(error)

  useEffect(() => {
    if (paused) {
      return
    }
    const startedAt = performance.now()
    const timeout = window.setTimeout(onClose, remainingDurationRef.current)
    return () => {
      window.clearTimeout(timeout)
      remainingDurationRef.current = Math.max(
        0,
        remainingDurationRef.current - (performance.now() - startedAt),
      )
    }
  }, [paused, onClose])

  useEffect(() => {
    const timers = copyTimersRef.current
    return () => {
      for (const timeout of Object.values(timers)) {
        window.clearTimeout(timeout)
      }
    }
  }, [])

  async function runAction(action: BrowserScreenshotAction) {
    if (runningRef.current.has(action)) {
      return
    }
    runningRef.current.add(action)
    setPendingActions((current) => [...current, action])
    setError('')
    try {
      await window.tidecodeBrowserPageActions.screenshotAction({
        ...screenshot,
        action,
      })
      if (action === 'copyPath' || action === 'copyImage') {
        window.clearTimeout(copyTimersRef.current[action])
        setCopied((current) => ({ ...current, [action]: true }))
        copyTimersRef.current[action] = window.setTimeout(() => {
          setCopied((current) => ({ ...current, [action]: false }))
          delete copyTimersRef.current[action]
        }, 2000)
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The screenshot action failed.',
      )
    } finally {
      runningRef.current.delete(action)
      setPendingActions((current) =>
        current.filter((pendingAction) => pendingAction !== action),
      )
    }
  }

  if (!containerRef.current) {
    return null
  }

  return createPortal(
    <div
      role="region"
      aria-label="Browser screenshot notification"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onPointerDownCapture={() => setFocused(false)}
      onFocusCapture={(event) =>
        setFocused(event.target.matches(':focus-visible'))
      }
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setFocused(false)
        }
      }}
      className="absolute right-3 top-14 z-[100] w-[380px] max-w-[calc(100%-1.5rem)] rounded-xl border border-border bg-surface-raised p-3 text-foreground shadow-lg"
    >
      <button
        type="button"
        aria-label="Dismiss screenshot notification"
        onClick={onClose}
        className="absolute right-1.5 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
      >
        <X size={14} />
      </button>
      <div role="status" className="pr-6 text-sm font-medium">
        Screenshot saved
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          aria-label={copied.copyPath ? 'Copied path' : 'Copy path'}
          aria-live="polite"
          disabled={pendingActions.includes('copyPath')}
          onClick={() => void runAction('copyPath')}
          className="inline-grid rounded-lg border border-border px-2 py-1.5 text-xs transition-colors hover:bg-surface-hover disabled:opacity-50"
        >
          <span
            aria-hidden={copied.copyPath}
            className={`col-start-1 row-start-1 ${copied.copyPath ? 'invisible' : ''}`}
          >
            Copy path
          </span>
          <span
            aria-hidden={!copied.copyPath}
            className={`col-start-1 row-start-1 ${!copied.copyPath ? 'invisible' : ''}`}
          >
            Copied path
          </span>
        </button>
        <button
          type="button"
          disabled={pendingActions.includes('reveal')}
          onClick={() => void runAction('reveal')}
          className="rounded-lg border border-border px-2 py-1.5 text-xs transition-colors hover:bg-surface-hover disabled:opacity-50"
        >
          Reveal in File Explorer
        </button>
        <button
          type="button"
          aria-label={copied.copyImage ? 'Copied image' : 'Copy image'}
          aria-live="polite"
          disabled={pendingActions.includes('copyImage')}
          onClick={() => void runAction('copyImage')}
          className="inline-grid rounded-lg bg-action px-2 py-1.5 text-xs text-action-foreground hover:bg-action-hover disabled:opacity-50"
        >
          <span
            aria-hidden={copied.copyImage}
            className={`col-start-1 row-start-1 ${copied.copyImage ? 'invisible' : ''}`}
          >
            Copy image
          </span>
          <span
            aria-hidden={!copied.copyImage}
            className={`col-start-1 row-start-1 ${!copied.copyImage ? 'invisible' : ''}`}
          >
            Copied image
          </span>
        </button>
      </div>
      {error ? (
        <p
          role="alert"
          className="mt-1.5 break-words text-xs text-danger-foreground"
        >
          {error}
        </p>
      ) : null}
    </div>,
    containerRef.current,
  )
}
