import { Camera } from 'lucide-react'
import { useCallback, useRef, useState, type RefObject } from 'react'
import { Tooltip } from '../Tooltip'
import type { BrowserScreenshot } from '../../types/browser'
import { BrowserScreenshotToast } from './BrowserScreenshotToast'
import { showAppError } from '../ui/appNotifications'

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
  const capturingRef = useRef(false)
  const closeToast = useCallback(() => setScreenshot(null), [])

  async function capture() {
    if (capturingRef.current) {
      return
    }
    capturingRef.current = true
    setCapturing(true)
    setScreenshot(null)
    try {
      setScreenshot(await onCapture())
    } catch (cause) {
      showAppError(cause, 'The screenshot could not be saved. Try again.', { operation: 'browser.screenshot' })
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
    </div>
  )
}
