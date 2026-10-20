import { EllipsisVertical, Minus, Plus, RotateCcw } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { DropdownPopover } from '../ui/DropdownPopover'
import { Tooltip } from '../Tooltip'
import { showAppError } from '../ui/appNotifications'
import type {
  BrowserPageControls,
  BrowserPageState,
} from './useBrowserPageActions'

interface BrowserMenuProps {
  partition: string
  pageState: BrowserPageState
  onOpenDevTools: BrowserPageControls['openDevTools']
  onChangeZoom: BrowserPageControls['changeZoom']
}

const itemClass =
  'flex h-9 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-foreground transition-colors hover:bg-[var(--dropdown-option-hover-surface)] focus-visible:bg-[var(--dropdown-option-hover-surface)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50'
const zoomButtonClass =
  'inline-flex h-7 w-7 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50'

export function BrowserMenu({
  partition,
  pageState,
  onOpenDevTools,
  onChangeZoom,
}: BrowserMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const id = useId()
  const close = useCallback(() => setIsOpen(false), [])

  useEffect(() => {
    if (isOpen) {
      panelRef.current
        ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
        ?.focus()
      setMessage('')
    }
  }, [isOpen])

  async function runAction(
    action: () => Promise<void>,
    success = '',
    dismiss = false,
  ) {
    if (pending) {
      return
    }
    setPending(true)
    setMessage('')
    try {
      await action()
      setMessage(success)
      if (dismiss) {
        close()
      }
    } catch (error) {
      showAppError(error, 'The browser action could not be completed. Try again.', { title: 'Browser action failed' })
    } finally {
      setPending(false)
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      return
    }
    event.preventDefault()
    const buttons = Array.from(
      panelRef.current?.querySelectorAll<HTMLButtonElement>(
        'button:not(:disabled)',
      ) ?? [],
    )
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    let nextIndex = index + 1
    if (event.key === 'ArrowUp') {
      nextIndex = index - 1
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = buttons.length - 1
    }
    buttons[(nextIndex + buttons.length) % buttons.length]?.focus()
  }

  return (
    <>
      <Tooltip content="Browser menu" side="bottom" noWrap>
        <button
          ref={buttonRef}
          type="button"
          aria-label="Browser menu"
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          aria-controls={id}
          onClick={() => setIsOpen((current) => !current)}
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:rounded-xl hover:bg-surface-muted hover:text-foreground"
        >
          <EllipsisVertical size={14} />
        </button>
      </Tooltip>
      <DropdownPopover
        id={id}
        role="dialog"
        aria-label="Browser actions"
        anchorRef={buttonRef}
        panelRef={panelRef}
        isOpen={isOpen}
        onClose={close}
        matchAnchorWidth={false}
        className="w-64 p-1"
        onKeyDown={handleKeyDown}
      >
        {pageState.isWebsite ? (
          <>
            <button
              type="button"
              className={itemClass}
              disabled={!pageState.canUsePage || pending}
              onClick={() => void runAction(onOpenDevTools, '', true)}
            >
              Open DevTools
            </button>
            <div className="my-1 h-px bg-border" />
          </>
        ) : null}
        {pageState.isWebsite ? (
          <div
            role="group"
            aria-label="Page zoom"
            className="flex h-10 items-center gap-2 px-3 text-sm"
          >
            <span className="mr-auto">Zoom</span>
            <button
              type="button"
              aria-label="Zoom out"
              className={zoomButtonClass}
              disabled={pending || pageState.zoomPercent <= 25}
              onClick={() => void runAction(() => onChangeZoom(-1))}
            >
              <Minus size={14} />
            </button>
            <span
              aria-live="polite"
              className="w-10 text-center text-xs tabular-nums text-muted-foreground"
            >
              {pageState.zoomPercent}%
            </span>
            <button
              type="button"
              aria-label="Zoom in"
              className={zoomButtonClass}
              disabled={pending || pageState.zoomPercent >= 500}
              onClick={() => void runAction(() => onChangeZoom(1))}
            >
              <Plus size={14} />
            </button>
            <button
              type="button"
              aria-label="Reset page zoom"
              className="inline-flex h-7 w-5 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-50"
              disabled={pending || pageState.zoomPercent === 100}
              onClick={() => void runAction(() => onChangeZoom(0))}
            >
              <RotateCcw size={14} />
            </button>
          </div>
        ) : null}
        {pageState.isWebsite ? <div className="my-1 h-px bg-border" /> : null}
        <button
          type="button"
          className={itemClass}
          disabled={pending}
          onClick={() =>
            void runAction(
              () =>
                window.tidecodeBrowserPageActions.clearCookies({ partition }),
              'Cookies cleared.',
            )
          }
        >
          Clear cookies
        </button>
        <button
          type="button"
          className={itemClass}
          disabled={pending}
          onClick={() =>
            void runAction(
              () => window.tidecodeBrowserPageActions.clearCache({ partition }),
              'Cache cleared.',
            )
          }
        >
          Clear cache
        </button>
        {message ? (
          <p
            role="status"
            className="px-3 py-2 text-xs text-muted-foreground"
          >
            {message}
          </p>
        ) : null}
      </DropdownPopover>
    </>
  )
}
