import type { ReactNode } from 'react'

interface WorkspaceHeaderProps {
  title: ReactNode
  isSidebarOpen: boolean
  leadingPaddingClassName?: string
  leadingContent?: ReactNode
  leadingContentClassName?: string
  trailingContent?: ReactNode
  trailingContentClassName?: string
}

export function WorkspaceHeader({
  title,
  leadingPaddingClassName,
  leadingContent,
  leadingContentClassName,
  trailingContent,
  trailingContentClassName,
}: WorkspaceHeaderProps) {
  return (
    <header
      className={[
        'flex h-14 shrink-0 items-center border-b border-border px-4 transition-[padding] duration-300 ease-out md:px-5',
        leadingPaddingClassName ?? '',
      ].join(' ')}
    >
      <div className="flex min-w-0 flex-1 self-stretch items-center">
        {leadingContent ? (
          <div className={['flex shrink-0 items-center', leadingContentClassName ?? 'mr-4'].join(' ')}>
            {leadingContent}
          </div>
        ) : null}
        <div className="flex min-w-0 flex-1 self-stretch items-center">
          {typeof title === 'string' ? (
            <p className="w-full truncate text-sm font-semibold text-foreground">{title}</p>
          ) : (
            title
          )}
        </div>
      </div>
      {trailingContent ? (
        <div className={['ml-3 flex shrink-0 items-center', trailingContentClassName ?? ''].join(' ')}>{trailingContent}</div>
      ) : null}
    </header>
  )
}
