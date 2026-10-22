import { Minus, Plus, RotateCcw } from 'lucide-react'

interface BrowserZoomControlsProps {
  percent: number
  disabled?: boolean
  floating?: boolean
  onChangeZoom: (direction: -1 | 0 | 1) => void
}

const buttonClass =
  'inline-flex h-7 w-7 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50'

export function BrowserZoomControls({ percent, disabled = false, floating = false, onChangeZoom }: BrowserZoomControlsProps) {
  return (
    <div
      role="group"
      aria-label={floating ? 'Floating page zoom' : 'Page zoom'}
      className="flex h-10 items-center gap-2 px-3 text-sm"
    >
      <span className="mr-auto">Zoom</span>
      <button
        type="button"
        aria-label={floating ? 'Floating zoom out' : 'Zoom out'}
        className={buttonClass}
        disabled={disabled || percent <= 25}
        onClick={() => onChangeZoom(-1)}
      >
        <Minus size={14} />
      </button>
      <span aria-live="polite" className="w-10 text-center text-xs tabular-nums text-muted-foreground">{percent}%</span>
      <button
        type="button"
        aria-label={floating ? 'Floating zoom in' : 'Zoom in'}
        className={buttonClass}
        disabled={disabled || percent >= 500}
        onClick={() => onChangeZoom(1)}
      >
        <Plus size={14} />
      </button>
      <button
        type="button"
        aria-label={floating ? 'Reset floating page zoom' : 'Reset page zoom'}
        className="inline-flex h-7 w-5 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-50"
        disabled={disabled || percent === 100}
        onClick={() => onChangeZoom(0)}
      >
        <RotateCcw size={14} />
      </button>
    </div>
  )
}
