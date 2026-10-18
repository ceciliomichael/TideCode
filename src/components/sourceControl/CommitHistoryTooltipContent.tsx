import type { GitHistoryCommitDetailsResult, GitHistoryEntry } from '../../types/chat'

interface CommitHistoryTooltipContentProps {
  details?: GitHistoryCommitDetailsResult
  entry: GitHistoryEntry
  isLoadingDetails: boolean
}

function sanitizeBodyLine(line: string) {
  const trimmed = line.trim()
  if (trimmed.length === 0) {
    return ''
  }

  return trimmed.replace(/^[-*]\s+/u, '')
}

function getBodyLines(details: GitHistoryCommitDetailsResult | undefined) {
  if (!details?.messageBody) {
    return []
  }

  return details.messageBody
    .split(/\r?\n/u)
    .map(sanitizeBodyLine)
    .filter((line) => line.length > 0)
    .slice(0, 5)
}

function formatRelativeCommitTime(authoredAt: string, fallback: string) {
  const authoredTime = new Date(authoredAt).getTime()
  if (!Number.isFinite(authoredTime)) {
    return fallback
  }

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - authoredTime) / 1000))
  if (elapsedSeconds < 60) {
    return `${elapsedSeconds} seconds ago`
  }

  const elapsedMinutes = Math.floor(elapsedSeconds / 60)
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes} ${elapsedMinutes === 1 ? 'minute' : 'minutes'} ago`
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60)
  if (elapsedHours < 24) {
    return `${elapsedHours} ${elapsedHours === 1 ? 'hour' : 'hours'} ago`
  }

  const elapsedDays = Math.floor(elapsedHours / 24)
  if (elapsedDays < 30) {
    return `${elapsedDays} ${elapsedDays === 1 ? 'day' : 'days'} ago`
  }

  const elapsedMonths = Math.floor(elapsedDays / 30)
  if (elapsedMonths < 12) {
    return `${elapsedMonths} ${elapsedMonths === 1 ? 'month' : 'months'} ago`
  }

  const elapsedYears = Math.floor(elapsedDays / 365)
  return `${elapsedYears} ${elapsedYears === 1 ? 'year' : 'years'} ago`
}

export function CommitHistoryTooltipContent({ details, entry, isLoadingDetails }: CommitHistoryTooltipContentProps) {
  const bodyLines = getBodyLines(details)

  return (
    <div className="max-w-[min(42rem,calc(100vw-24px))] overflow-hidden rounded-xl border border-tooltip-border bg-tooltip-surface text-tooltip-foreground shadow-soft">
      <div className="border-b border-border/80 px-3.5 py-2.5">
        <p className="text-[13px] font-semibold leading-5 text-foreground">{entry.authorName}</p>
        <p className="text-[12px] text-muted-foreground">
          {formatRelativeCommitTime(entry.authoredAt, entry.authoredRelativeTime)}
        </p>
      </div>

      <div className="space-y-2.5 px-3.5 py-3">
        <p className="text-[14px] font-medium leading-5 text-foreground">{entry.subject.length > 0 ? entry.subject : '(no subject)'}</p>

        {isLoadingDetails ? <p className="text-[12px] text-muted-foreground">Loading commit details...</p> : null}

        {!isLoadingDetails && bodyLines.length > 0 ? (
          <ul className="space-y-1.5 text-[12.5px] text-muted-foreground">
            {bodyLines.map((line, index) => (
              <li key={`${entry.hash}-${index}`} className="flex items-start gap-2">
                <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/70" />
                <span className="leading-5">{line}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {!isLoadingDetails && details ? (
          <p className="border-t border-border/70 pt-2 text-[12px] text-muted-foreground">
            <span>{`${details.changedFileCount} files changed, `}</span>
          <span className="text-git-added">{`${details.insertions} insertions(+)`}</span>
            <span>{', '}</span>
          <span className="text-git-removed">{`${details.deletions} deletions(-)`}</span>
          </p>
        ) : null}
      </div>

      <div className="border-t border-border/80 px-3.5 py-2 text-[12px] text-muted-foreground">
        {entry.shortHash}
      </div>
    </div>
  )
}
