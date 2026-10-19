import { Plus } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { Tooltip } from '../Tooltip'
import { DropdownPopover } from '../ui/DropdownPopover'

interface BrowserNewTabMenuProps {
  onCreateTab: (incognito: boolean) => Promise<void>
}

export function BrowserNewTabMenu({ onCreateTab }: BrowserNewTabMenuProps) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const id = useId()
  const close = useCallback(() => setOpen(false), [])
  const canUseIncognito =
    typeof window !== 'undefined' &&
    Boolean(window.tidecodeBrowserPageActions?.createIncognitoTab)

  useEffect(() => {
    if (open) {
      setError('')
      const frame = window.requestAnimationFrame(() => {
        panelRef.current
          ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
          ?.focus()
      })
      return () => window.cancelAnimationFrame(frame)
    }
  }, [open])

  async function createTab(incognito: boolean) {
    if (pending) {
      return
    }
    setPending(true)
    setError('')
    try {
      await onCreateTab(incognito)
      close()
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'The tab could not be opened.',
      )
    } finally {
      setPending(false)
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      return
    }
    event.preventDefault()
    const items = Array.from(
      panelRef.current?.querySelectorAll<HTMLButtonElement>(
        'button:not(:disabled)',
      ) ?? [],
    )
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    let next = current + 1
    if (event.key === 'ArrowUp') {
      next = current - 1
    } else if (event.key === 'Home') {
      next = 0
    } else if (event.key === 'End') {
      next = items.length - 1
    }
    items[(next + items.length) % items.length]?.focus()
  }

  const itemClass =
    'flex h-9 w-full items-center rounded-lg px-3 text-left text-sm text-foreground transition-colors hover:bg-[var(--dropdown-option-hover-surface)] focus-visible:bg-[var(--dropdown-option-hover-surface)] focus-visible:outline-none disabled:opacity-50'

  return (
    <>
      <Tooltip content="New browser tab" side="bottom" noWrap>
        <button
          ref={buttonRef}
          type="button"
          aria-label="New browser tab"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((current) => !current)}
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:rounded-xl hover:bg-surface-muted hover:text-foreground"
        >
          <Plus size={14} />
        </button>
      </Tooltip>
      <DropdownPopover
        id={id}
        role="menu"
        aria-label="New browser tab options"
        anchorRef={buttonRef}
        panelRef={panelRef}
        isOpen={open}
        onClose={close}
        matchAnchorWidth={false}
        className="w-52 p-1"
        onKeyDown={handleKeyDown}
      >
        <button
          type="button"
          role="menuitem"
          disabled={pending}
          onClick={() => void createTab(false)}
          className={itemClass}
        >
          New tab
        </button>
        <button
          type="button"
          role="menuitem"
          disabled={pending || !canUseIncognito}
          onClick={() => void createTab(true)}
          className={itemClass}
        >
          New incognito tab
        </button>
        {error ? (
          <p role="alert" className="px-3 py-2 text-xs text-danger-foreground">
            {error}
          </p>
        ) : null}
      </DropdownPopover>
    </>
  )
}
