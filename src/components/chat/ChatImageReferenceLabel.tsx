import type { ChatImageAttachment } from '../../types/chat'
import { Tooltip } from '../Tooltip'

interface ChatImageReferenceLabelProps {
  attachment: ChatImageAttachment
  label: string
  onHoverChange?: (isHovered: boolean) => void
  variant: 'backdrop' | 'inline' | 'rendered'
}

const surfaceClassName = 'rounded-[4px] border border-action/20 bg-action/15'

export function ChatImageReferenceLabel({ attachment, label, onHoverChange, variant }: ChatImageReferenceLabelProps) {
  return (
    <Tooltip
      content={(
        <div className="rounded-lg border border-border bg-surface p-1.5">
          <img
            src={attachment.dataUrl}
            alt={label}
            className="block h-auto w-auto max-h-[min(20rem,calc(100vh-3rem))] max-w-[min(24rem,calc(100vw-3rem))] rounded-md object-contain"
          />
        </div>
      )}
      noWrap
      panelClassName="!max-w-none !border-0 !bg-transparent !p-0"
      triggerClassName={variant === 'backdrop' ? 'pointer-events-auto align-baseline' : 'align-baseline'}
      triggerLayout="inline"
    >
      <span
        tabIndex={variant === 'backdrop' ? undefined : 0}
        onBlur={() => onHoverChange?.(false)}
        onFocus={() => onHoverChange?.(true)}
        onMouseEnter={() => onHoverChange?.(true)}
        onMouseLeave={() => onHoverChange?.(false)}
        className={[
          'relative inline align-baseline font-normal',
          surfaceClassName,
          variant === 'backdrop' ? 'cursor-default text-transparent' : 'text-foreground',
        ].join(' ')}
      >
        {label}
      </span>
    </Tooltip>
  )
}
