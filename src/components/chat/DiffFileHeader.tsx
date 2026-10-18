import { useMemo, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { resolveFileIconConfig } from '../../lib/fileIconResolver'
import { PathLabel } from './PathLabel'

// Includes the stacked row's outer bottom border.
export const CONVERSATION_DIFF_ROW_HEIGHT_PX = 53

interface DiffFileHeaderProps {
  filePath: string
  collapsible: boolean
  isExpanded: boolean
  stableLayout?: boolean
  className?: string
  inlineContent?: ReactNode
  rightContent?: ReactNode
  trailingContent?: ReactNode
  onToggle?: () => void
  onFocus?: () => void
  onPointerEnter?: () => void
}

export function DiffFileHeader({
  filePath,
  collapsible,
  isExpanded,
  stableLayout = false,
  className,
  inlineContent,
  rightContent,
  trailingContent,
  onToggle,
  onFocus,
  onPointerEnter,
}: DiffFileHeaderProps) {
  const iconConfig = useMemo(() => resolveFileIconConfig({ fileName: filePath }), [filePath])
  const FileIcon = iconConfig.icon
  const mainContent = (
    <span className="inline-flex min-h-4 min-w-0 flex-1 items-center gap-2">
      <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
        <FileIcon
          size={14}
          style={{ color: iconConfig.color }}
          aria-hidden="true"
          className={collapsible ? 'transition-opacity duration-150 group-hover:opacity-0 group-focus-visible:opacity-0' : ''}
        />
        {collapsible ? (
          <ChevronRight
            size={14}
            className={[
              'absolute inset-0 m-auto text-muted-foreground opacity-0 transition-[opacity,transform] duration-200 group-hover:opacity-100 group-focus-visible:opacity-100',
              isExpanded ? 'rotate-90' : '',
            ].join(' ')}
          />
        ) : null}
      </span>
      <span className={['inline-flex min-w-0 items-center gap-2', stableLayout ? 'relative top-px' : ''].join(' ')}>
        <PathLabel path={filePath} className="min-w-0 leading-[1] text-foreground" />
        {inlineContent ? <span className="inline-flex shrink-0 items-center">{inlineContent}</span> : null}
        {trailingContent ? <span className="inline-flex shrink-0 items-center">{trailingContent}</span> : null}
      </span>
    </span>
  )

  return (
    <div
      data-diff-file-header={filePath}
      className={[
        'non-selectable-ui group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center bg-surface px-4 text-[12px] text-muted-foreground',
        stableLayout ? 'border-b' : 'py-3',
        stableLayout && !isExpanded ? 'border-transparent' : '',
        !collapsible || isExpanded ? 'border-b border-border' : '',
        className ?? '',
      ].join(' ')}
      style={stableLayout ? { height: CONVERSATION_DIFF_ROW_HEIGHT_PX - 1 } : undefined}
    >
      {collapsible ? (
        <button
          type="button"
          aria-expanded={isExpanded}
          onClick={onToggle}
          onFocus={onFocus}
          onPointerEnter={onPointerEnter}
          className="group flex min-w-0 w-full items-center text-left"
        >
          {mainContent}
        </button>
      ) : mainContent}
      {rightContent ? (
        <span className={[
          'ml-3 inline-flex shrink-0 items-center',
          stableLayout ? 'w-[4.5rem] justify-end' : '',
        ].join(' ')}>
          {rightContent}
        </span>
      ) : null}
    </div>
  )
}
