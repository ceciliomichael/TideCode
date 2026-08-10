import {
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronDown,
  Loader2,
  LocateFixed,
  RefreshCw,
  Upload,
  type LucideIcon,
} from 'lucide-react'
import type { MutableRefObject, PointerEvent as ReactPointerEvent } from 'react'
import type { GitHistoryCommitDetailsResult, GitSyncAction } from '../../types/chat'
import { Tooltip } from '../Tooltip'
import type { HistoryItemViewModel } from './historyGraphLayout'
import { VirtualizedSourceControlHistoryList } from './VirtualizedSourceControlHistoryList'

interface SyncActionConfig {
  action: GitSyncAction
  icon: LucideIcon
  label: string
}

const SYNC_ACTIONS: readonly SyncActionConfig[] = [
  {
    action: 'fetch-all',
    icon: Upload,
    label: 'Fetch all remotes',
  },
  {
    action: 'pull',
    icon: ArrowDownToLine,
    label: 'Pull latest changes',
  },
  {
    action: 'push',
    icon: ArrowUpToLine,
    label: 'Push current branch',
  },
]

interface SourceControlHistorySectionProps {
  commitDetailsByHash: Readonly<Record<string, GitHistoryCommitDetailsResult>>
  expandedCommitHashes: readonly string[]
  hasMoreHistory: boolean
  hasWorkspacePath: boolean
  headHash: string | null
  historyEntries: readonly HistoryItemViewModel['entry'][]
  historyError: string | null
  historyHeight: number | null
  historyRowRefMap: MutableRefObject<Map<string, HTMLButtonElement | null>>
  historyViewModels: readonly HistoryItemViewModel[]
  isHistorySectionOpen: boolean
  isLoadingHistory: boolean
  isLoadingMoreHistory: boolean
  isOperationInProgress: boolean
  loadingCommitHashes: readonly string[]
  pendingSyncAction: GitSyncAction | 'refresh' | null
  selectedCommitHash: string | null
  showResizeHandle: boolean
  onGoToCurrentCommit: () => Promise<void>
  onHistoryResizePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onLoadCommitDetails: (commitHash: string) => Promise<void>
  onLoadMoreHistory: () => Promise<void>
  onRefreshPanel: () => Promise<void>
  onSyncAction: (action: GitSyncAction) => Promise<void>
  onToggleCommitExpanded: (commitHash: string) => void
  onToggleHistorySection: () => void
}

export function SourceControlHistorySection({
  commitDetailsByHash,
  expandedCommitHashes,
  hasMoreHistory,
  hasWorkspacePath,
  headHash,
  historyEntries,
  historyError,
  historyHeight,
  historyRowRefMap,
  historyViewModels,
  isHistorySectionOpen,
  isLoadingHistory,
  isLoadingMoreHistory,
  isOperationInProgress,
  loadingCommitHashes,
  pendingSyncAction,
  selectedCommitHash,
  showResizeHandle,
  onGoToCurrentCommit,
  onHistoryResizePointerDown,
  onLoadCommitDetails,
  onLoadMoreHistory,
  onRefreshPanel,
  onSyncAction,
  onToggleCommitExpanded,
  onToggleHistorySection,
}: SourceControlHistorySectionProps) {
  return (
    <section
      className={[
        isHistorySectionOpen
          ? 'min-h-0 shrink-0 flex flex-1 flex-col'
          : 'mt-auto shrink-0 border-t border-border',
      ].join(' ')}
      style={
        isHistorySectionOpen && historyHeight !== null
          ? {
              flex: '0 0 auto',
              height: `${historyHeight}px`,
            }
          : undefined
      }
    >
      {showResizeHandle ? (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize history section"
          onPointerDown={onHistoryResizePointerDown}
          className={[
            'h-1 w-full bg-transparent',
            isHistorySectionOpen ? 'cursor-row-resize' : 'cursor-default',
          ].join(' ')}
        />
      ) : null}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={isHistorySectionOpen}
        onClick={onToggleHistorySection}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') {
            return
          }

          event.preventDefault()
          onToggleHistorySection()
        }}
        className="flex h-10 cursor-pointer items-center justify-between px-4"
      >
        <span className="inline-flex items-center gap-2 text-left">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">History</span>
          <ChevronDown
            size={13}
            className={['text-muted-foreground transition-transform', isHistorySectionOpen ? '' : '-rotate-90'].join(' ')}
          />
        </span>
        <div className="inline-flex items-center gap-0.5" onClick={(event) => event.stopPropagation()}>
          {SYNC_ACTIONS.map((config) => {
            const Icon = config.icon
            const isPending = pendingSyncAction === config.action

            return (
              <Tooltip key={config.action} content={config.label} side="top">
                <button
                  type="button"
                  aria-label={config.label}
                  disabled={!hasWorkspacePath || isOperationInProgress || pendingSyncAction !== null}
                  onClick={() => void onSyncAction(config.action)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isPending ? <Loader2 size={13} className="animate-spin" /> : <Icon size={13} />}
                </button>
              </Tooltip>
            )
          })}

          <Tooltip content="Refresh source control" side="top">
            <button
              type="button"
              aria-label="Refresh source control"
              disabled={!hasWorkspacePath || isOperationInProgress || pendingSyncAction !== null}
              onClick={() => void onRefreshPanel()}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw size={13} />
            </button>
          </Tooltip>

          <Tooltip content="Go to HEAD commit" side="top">
            <button
              type="button"
              aria-label="Go to HEAD commit"
              disabled={!headHash}
              onClick={() => void onGoToCurrentCommit()}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <LocateFixed size={13} />
            </button>
          </Tooltip>
        </div>
      </div>

      {isHistorySectionOpen ? (
        isLoadingHistory ? (
          <div className="flex flex-1 items-center justify-center border-t border-border text-[12px] text-muted-foreground">
            <Loader2 size={14} className="mr-2 animate-spin" />
            Loading history...
          </div>
        ) : historyEntries.length === 0 ? (
          <div className="flex flex-1 flex-col border-t border-border px-4 py-3">
            <div className="flex min-h-16 items-center text-[12px] text-muted-foreground">No commits yet.</div>
          </div>
        ) : (
          <VirtualizedSourceControlHistoryList
            bodyClassName="min-h-0 flex-1 overflow-y-auto border-t border-border"
            commitDetailsByHash={commitDetailsByHash}
            expandedCommitHashes={expandedCommitHashes}
            hasMoreHistory={hasMoreHistory}
            historyError={historyError}
            historyRowRefMap={historyRowRefMap}
            historyViewModels={historyViewModels}
            isLoadingMoreHistory={isLoadingMoreHistory}
            loadingCommitHashes={loadingCommitHashes}
            selectedCommitHash={selectedCommitHash}
            onLoadCommitDetails={onLoadCommitDetails}
            onLoadMoreHistory={onLoadMoreHistory}
            onToggleCommitExpanded={onToggleCommitExpanded}
          />
        )
      ) : null}
    </section>
  )
}
