import type { ContextUsageEstimate } from '../../types/chat'
import { DashedMetricCircle } from './DashedMetricCircle'
import { Tooltip } from '../Tooltip'

interface ContextIndicatorProps {
  disabled?: boolean
  isCompressing?: boolean
  compressDisabled?: boolean
  onCompress?: () => void
  usage: ContextUsageEstimate
}

function formatTokenCount(tokens: number) {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(tokens >= 10_000 ? 0 : 1)}k`
  }

  return tokens.toString()
}

function getUsageColor(usageRatio: number) {
  if (usageRatio >= 0.9) {
    return 'var(--color-danger-foreground)'
  }

  if (usageRatio >= 0.75) {
    return 'color-mix(in srgb, var(--color-danger-foreground) 72%, var(--color-foreground))'
  }

  return 'var(--color-action)'
}

function getEstimatedContextTokens(usage: ContextUsageEstimate) {
  if (Number.isFinite(usage.totalTokens) && usage.totalTokens >= 0) {
    return usage.totalTokens
  }

  return usage.systemPromptTokens + usage.historyTokens + usage.toolResultsTokens
}

function getEffectiveMaxTokens(usage: ContextUsageEstimate) {
  return usage.maxTokens > 0 ? usage.maxTokens : 200_000
}

function DashedUsageCircle({
  forceAllActive = false,
  usage,
}: {
  forceAllActive?: boolean
  usage: ContextUsageEstimate
}) {
  const estimatedTotalTokens = getEstimatedContextTokens(usage)
  const usageRatio = Math.min(estimatedTotalTokens / getEffectiveMaxTokens(usage), 1)
  const activeColor = getUsageColor(usageRatio)

  return (
    <DashedMetricCircle
      activeColor={activeColor}
      inactiveColor="var(--color-border)"
      percent={forceAllActive ? 100 : usageRatio * 100}
      size={18}
    />
  )
}

export function ContextIndicator({
  compressDisabled = false,
  disabled = false,
  isCompressing = false,
  onCompress,
  usage,
}: ContextIndicatorProps) {
  const isIndicatorDisabled = disabled || isCompressing
  const estimatedTotalTokens = getEstimatedContextTokens(usage)
  const effectiveMaxTokens = getEffectiveMaxTokens(usage)
  const usageRatio = Math.min(estimatedTotalTokens / effectiveMaxTokens, 1)
  const usagePercent = Math.min(usageRatio, 1) * 100
  const tooltipContent = (
    <div className="flex flex-col gap-0">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-foreground">Context estimate</span>
        <span className="inline-flex min-h-5 items-center justify-center rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium leading-none text-accent-foreground">
          {usagePercent.toFixed(1)}%
        </span>
      </div>

      <div className="mt-3 space-y-1.5">
        <div className="flex items-center justify-between gap-3 text-subtle-foreground">
          <span>System + tools</span>
          <span className="text-foreground">{formatTokenCount(usage.systemPromptTokens)}</span>
        </div>
        <div className="flex items-center justify-between gap-3 text-subtle-foreground">
          <span>Chat history</span>
          <span className="text-foreground">{formatTokenCount(usage.historyTokens)}</span>
        </div>
        <div className="flex items-center justify-between gap-3 text-subtle-foreground">
          <span>Tool results</span>
          <span className="text-foreground">{formatTokenCount(usage.toolResultsTokens)}</span>
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 border-t border-border pt-2 text-foreground">
          <span className="font-medium">Total / {formatTokenCount(effectiveMaxTokens)}</span>
          <span className="font-medium">
            {formatTokenCount(estimatedTotalTokens)} / {formatTokenCount(effectiveMaxTokens)}
          </span>
        </div>
      </div>

      {onCompress ? (
        <div className="mt-3 border-t border-border pt-3">
          <button
            type="button"
            onClick={onCompress}
            disabled={compressDisabled || isCompressing}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-action px-3 text-sm font-medium text-white transition-colors hover:bg-action-hover disabled:cursor-not-allowed disabled:bg-disabled disabled:text-disabled-foreground"
          >
            <span>{isCompressing ? 'Compressing...' : 'Compress Chat'}</span>
          </button>
        </div>
      ) : null}
    </div>
  )

  return (
    <Tooltip
      content={tooltipContent}
      disabled={isIndicatorDisabled}
      side="top"
      interactive
      hideDelayMs={160}
      panelClassName="!block !w-56 !max-w-[calc(100vw-24px)] !rounded-2xl !border-border !bg-surface !p-3 !text-foreground !shadow-soft"
    >
      <button
        type="button"
        aria-label={`Estimated context usage ${formatTokenCount(estimatedTotalTokens)} of ${formatTokenCount(effectiveMaxTokens)} tokens`}
        className="flex items-center justify-center bg-transparent p-0 text-muted-foreground transition-colors duration-150 hover:text-foreground disabled:cursor-default disabled:opacity-80"
        disabled={isIndicatorDisabled}
      >
        <span className={isCompressing ? "animate-spin" : undefined}>
          <DashedUsageCircle forceAllActive={isCompressing} usage={usage} />
        </span>
      </button>
    </Tooltip>
  )
}
