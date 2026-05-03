import { Calendar, Clock } from 'lucide-react'
import type { CodexUsageSnapshot } from '../../types/chat'
import { buildCodexUsageSummaryItems, formatCodexUsageResetCountdown } from './codexUsage'

interface CodexUsagePillsProps {
  className?: string
  usage: CodexUsageSnapshot | null
}

export function CodexUsagePills({ className, usage }: CodexUsagePillsProps) {
  const items = buildCodexUsageSummaryItems(usage)

  if (items.length === 0) {
    return null
  }

  return (
    <div className={['flex flex-wrap items-center gap-2', className].filter(Boolean).join(' ')}>
      {items.map((item) => {
        const Icon = item.label === 'Week' ? Calendar : Clock
        const title = `${item.label} window resets in ${formatCodexUsageResetCountdown(item.resetAfterSeconds)}`

        return (
          <span
            key={`${item.windowKind}-${item.label}`}
            title={title}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-border bg-surface-muted px-3 text-[11px] font-medium text-muted-foreground"
          >
            <Icon size={12} className="-mt-px shrink-0 text-muted-foreground" />
            <span className="leading-[12px]">
              {item.label} {item.remainingPercent}%
            </span>
          </span>
        )
      })}
    </div>
  )
}
