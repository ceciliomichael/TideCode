import { Camera, X } from 'lucide-react'
import { useCallback, useRef, useState, type RefObject } from 'react'
import { Tooltip } from '../Tooltip'
import type { BrowserScreenshot } from '../../types/browser'
import { BrowserScreenshotToast } from './BrowserScreenshotToast'

interface BrowserScreenshotButtonProps {
  toastContainerRef: RefObject<HTMLDivElement | null>
  active: boolean
  disabled: boolean
  onCapture: () => Promise<BrowserScreenshot>
}

export function BrowserScreenshotButton({
  toastContainerRef,
  active,
  disabled,
  onCapture,
}: BrowserScreenshotButtonProps) {
  const [capturing, setCapturing] = useState(false)
  const [screenshot, setScreenshot] = useState<BrowserScreenshot | null>(null)
  const [error, setError] = useState('')
  const capturingRef = useRef(false)
  const closeToast = useCallback(() => setScreenshot(null), [])

  async function capture() {
    if (capturingRef.current) {
      return
    }
    capturingRef.current = true
    setCapturing(true)
    setScreenshot(null)
    setError('')
    try {
      setScreenshot(await onCapture())
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The screenshot could not be saved.',
      )
    } finally {
      capturingRef.current = false
      setCapturing(false)
    }
  }

  return (
    <div className="relative flex shrink-0 items-center">
      <Tooltip content="Screenshot" side="bottom" noWrap>
        <button
          type="button"
          aria-label="Screenshot"
          disabled={disabled || capturing}
          onClick={() => void capture()}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Camera size={16} />
        </button>
      </Tooltip>
      {active && screenshot ? (
        <BrowserScreenshotToast
          containerRef={toastContainerRef}
          key={screenshot.filePath}
          screenshot={screenshot}
          onClose={closeToast}
        />
      ) : null}
      {error ? (
        <div
          role="alert"
          className="absolute right-0 top-full z-50 mt-1 flex w-72 items-start gap-2 rounded-lg border border-border bg-background p-3 text-xs text-danger-foreground shadow-lg"
        >
          <span className="flex-1">{error}</span>
          <button
            type="button"
            aria-label="Dismiss screenshot error"
            onClick={() => setError('')}
          >
            <X size={14} />
          </button>
        </div>
      ) : null}
    </div>
  )
}
