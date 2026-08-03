import { FileCode } from 'lucide-react'
import { getPathBasename } from '../../lib/pathPresentation'
import { resolveFileIconConfig } from '../../lib/fileIconResolver'
import type { WorkspaceRefactorCandidate } from '../../types/chat'
import { DashedMetricCircle } from './DashedMetricCircle'
import { Tooltip } from '../Tooltip'

interface RefactorCandidatesIndicatorProps {
  candidates: readonly WorkspaceRefactorCandidate[]
  disabled?: boolean
  isLoading?: boolean
  onSelectCandidate?: (relativePath: string) => void
}

function formatLineCount(lineCount: number) {
  if (lineCount >= 1000) {
    return `${(lineCount / 1000).toFixed(1)}k`
  }

  return lineCount.toString()
}

export function RefactorCandidatesIndicator({
  candidates,
  disabled = false,
  isLoading = false,
  onSelectCandidate,
}: RefactorCandidatesIndicatorProps) {
  const candidateCount = candidates.length
  const indicatorPercent = isLoading ? 100 : Math.min((candidateCount / 10) * 100, 100)
  const isEmpty = !isLoading && candidateCount === 0
  const buttonClassName = [
    'flex items-center justify-center bg-transparent p-0 transition-colors duration-150 disabled:cursor-default disabled:opacity-80',
    isEmpty ? 'text-subtle-foreground hover:text-muted-foreground' : 'text-muted-foreground hover:text-foreground',
  ].join(' ')

  const tooltipBody = isLoading ? (
    <p className="text-subtle-foreground">Scanning the workspace for large code files.</p>
  ) : isEmpty ? (
    <p className="text-subtle-foreground">No large code files above 300 lines were found.</p>
  ) : (
    <>
      <p className="text-subtle-foreground">Large code files that are strong refactor candidates.</p>
      <div className="mt-3 overflow-hidden rounded-2xl border border-border bg-surface-muted/35">
        <div className="max-h-56 overflow-y-auto">
          {candidates.map((candidate, index) => {
            const basename = getPathBasename(candidate.relativePath)
            const iconConfig = resolveFileIconConfig({ fileName: candidate.relativePath })
            const FileIcon = iconConfig.icon
            const isLastItem = index === candidates.length - 1

            return (
              <button
                key={candidate.relativePath}
                type="button"
                className={[
                  'flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-surface-muted',
                  isLastItem ? '' : 'border-b border-border',
                ].join(' ')}
                onClick={() => {
                  onSelectCandidate?.(candidate.relativePath)
                }}
              >
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <FileIcon size={14} className="shrink-0" style={{ color: iconConfig.color }} />
                  <span className="truncate text-[12px] font-medium leading-4 text-foreground">{basename}</span>
                </span>
                <span className="shrink-0 text-[11px] font-medium leading-4 text-subtle-foreground">
                  {formatLineCount(candidate.lineCount)} lines
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </>
  )

  const tooltipContent = (
    <div className="flex flex-col gap-0">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <FileCode size={14} className="text-foreground" />
          <span className="font-medium text-foreground">Refactor candidates</span>
        </div>
        {isLoading ? (
          <span className="inline-flex min-h-5 items-center justify-center rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-medium leading-none text-subtle-foreground">
            Scanning
          </span>
        ) : (
          <span className="inline-flex min-h-5 items-center justify-center rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium leading-none text-accent-foreground">
            {candidateCount} {candidateCount === 1 ? 'file' : 'files'}
          </span>
        )}
      </div>

      {tooltipBody}
    </div>
  )

  return (
    <Tooltip
      content={tooltipContent}
      disabled={disabled}
      side="top"
      interactive
      hideDelayMs={60}
      panelClassName="!block !w-[24rem] !max-w-[calc(100vw-24px)] !rounded-2xl !border-border !bg-surface !p-3 !text-foreground !shadow-soft"
    >
      <button
        type="button"
        aria-label={
          isLoading
            ? 'Scanning workspace for refactor candidates'
            : isEmpty
              ? 'No refactor candidates detected'
              : `${candidateCount} refactor candidates detected`
        }
        className={buttonClassName}
        disabled={disabled}
      >
        <div className={isLoading ? 'animate-spin' : ''}>
          <DashedMetricCircle
            activeColor="currentColor"
            inactiveColor="var(--color-border)"
            percent={indicatorPercent}
            size={18}
          />
        </div>
      </button>
    </Tooltip>
  )
}
