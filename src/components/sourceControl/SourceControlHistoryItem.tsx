import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { memo, useCallback, type MutableRefObject } from 'react'
import { Tooltip } from '../Tooltip'
import { CommitHistoryTooltipContent } from './CommitHistoryTooltipContent'
import { CommitFileRow } from './CommitFileRow'
import type { GitHistoryCommitDetailsResult, GitHistoryCommitFile } from '../../types/chat'
import type { HistoryItemViewModel } from './historyGraphLayout'
import { getSwimlaneIndentPx } from './historyGraphLayout'
import { GitGraphLane, GitGraphPlaceholder } from './historyGraph'

interface SourceControlHistoryItemProps {
  commitDetails: GitHistoryCommitDetailsResult | undefined
  historyRowRefMap: MutableRefObject<Map<string, HTMLButtonElement | null>>
  isExpanded: boolean
  isLoadingDetails: boolean
  isSelected: boolean
  viewModel: HistoryItemViewModel
  onLoadCommitDetails: (commitHash: string) => Promise<void>
  onToggleCommitExpanded: (commitHash: string) => void
}

function renderCommitDetails(input: {
  commitHash: string
  files: readonly GitHistoryCommitFile[]
  laneColumnCount: number
  isLoadingDetails: boolean
}) {
  const { commitHash, files, laneColumnCount, isLoadingDetails } = input
  const indentPx = getSwimlaneIndentPx(laneColumnCount)

  if (isLoadingDetails) {
    return (
      <div className="flex items-center gap-2 py-2 pr-3 text-[12px] text-muted-foreground" style={{ paddingLeft: `${indentPx + 12}px` }}>
        <Loader2 size={13} className="animate-spin" />
        Loading files...
      </div>
    )
  }

  if (files.length === 0) {
    return (
      <div className="py-2 pr-3 text-[12px] text-muted-foreground" style={{ paddingLeft: `${indentPx + 12}px` }}>
        No changed files.
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {files.map((file) => (
        <CommitFileRow key={`${commitHash}-${file.path}`} file={file} indentPx={indentPx} />
      ))}
    </div>
  )
}

function SourceControlHistoryItemComponent({
  commitDetails,
  historyRowRefMap,
  isExpanded,
  isLoadingDetails,
  isSelected,
  viewModel,
  onLoadCommitDetails,
  onToggleCommitExpanded,
}: SourceControlHistoryItemProps) {
  const { entry, inputSwimlanes, outputSwimlanes } = viewModel
  const continuationColumns = outputSwimlanes.length > 0 ? outputSwimlanes : inputSwimlanes

  const handleToggle = useCallback(() => {
    onToggleCommitExpanded(entry.hash)
  }, [entry.hash, onToggleCommitExpanded])

  return (
    <div key={entry.hash}>
      <Tooltip content={<CommitHistoryTooltipContent entry={entry} details={commitDetails} isLoadingDetails={isLoadingDetails} />} side="left" lockSide fullWidthTrigger interactive panelClassName="!max-w-[min(42rem,calc(100vw-24px))] !border-0 !bg-transparent !p-0 !text-left !shadow-none">
        <button
          type="button"
          ref={(node) => {
            historyRowRefMap.current.set(entry.hash, node)
          }}
          onClick={handleToggle}
          onMouseEnter={() => {
            void onLoadCommitDetails(entry.hash)
          }}
          onFocus={() => {
            void onLoadCommitDetails(entry.hash)
          }}
          className={[
            'flex h-[50px] w-full items-center gap-0 text-left transition-colors',
            isSelected ? 'bg-brand-soft text-brand-soft-foreground' : 'hover:bg-surface-muted/50',
          ].join(' ')}
        >
          <GitGraphLane viewModel={viewModel} />

          <span className="min-w-0 flex-1 py-1.5 pr-2">
            <span className="flex items-center gap-1.5">
              <span className="min-w-0 shrink truncate text-[13px] font-medium leading-5 text-foreground">
                {entry.subject.length > 0 ? entry.subject : '(no subject)'}
              </span>
              <span className="ml-auto shrink-0 pl-2 text-subtle-foreground">
                {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </span>
            </span>
          </span>
        </button>
      </Tooltip>

      {isExpanded ? (
        <div className="relative flex bg-surface-muted/10">
          <div className="z-10 min-w-0 flex-1">
            {renderCommitDetails({
              commitHash: entry.hash,
              files: commitDetails?.files ?? [],
              laneColumnCount: continuationColumns.length,
              isLoadingDetails,
            })}
          </div>
          <div className="pointer-events-none absolute inset-y-0 left-0 z-20 w-fit">
            <GitGraphPlaceholder columns={continuationColumns} />
          </div>
        </div>
      ) : null}
    </div>
  )
}

function serializeSwimlanes(nodes: HistoryItemViewModel['inputSwimlanes']) {
  return nodes.map((node) => `${node.id}:${node.color}`).join('|')
}

function areSourceControlHistoryItemPropsEqual(
  left: SourceControlHistoryItemProps,
  right: SourceControlHistoryItemProps,
) {
  return (
    left.isExpanded === right.isExpanded &&
    left.isSelected === right.isSelected &&
    left.isLoadingDetails === right.isLoadingDetails &&
    left.commitDetails === right.commitDetails &&
    left.viewModel.entry.hash === right.viewModel.entry.hash &&
    left.viewModel.entry.subject === right.viewModel.entry.subject &&
    left.viewModel.entry.authorName === right.viewModel.entry.authorName &&
    left.viewModel.entry.authoredRelativeTime === right.viewModel.entry.authoredRelativeTime &&
    left.viewModel.entry.shortHash === right.viewModel.entry.shortHash &&
    left.viewModel.entry.isHead === right.viewModel.entry.isHead &&
    left.viewModel.entry.parentIds.join('|') === right.viewModel.entry.parentIds.join('|') &&
    left.viewModel.kind === right.viewModel.kind &&
    serializeSwimlanes(left.viewModel.inputSwimlanes) === serializeSwimlanes(right.viewModel.inputSwimlanes) &&
    serializeSwimlanes(left.viewModel.outputSwimlanes) === serializeSwimlanes(right.viewModel.outputSwimlanes)
  )
}

export const SourceControlHistoryItem = memo(
  SourceControlHistoryItemComponent,
  areSourceControlHistoryItemPropsEqual,
)
