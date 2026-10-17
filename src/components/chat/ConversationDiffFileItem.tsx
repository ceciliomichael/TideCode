import { memo, useCallback, type CSSProperties, type ReactElement } from 'react'
import { Minus, Plus, Undo2 } from 'lucide-react'
import type { ConversationFileDiff } from '../../lib/chatDiffs'
import { DiffViewer } from './DiffViewer'
import { CONVERSATION_DIFF_ROW_HEIGHT_PX, DiffFileHeader } from './DiffFileHeader'
import { Tooltip } from '../Tooltip'

interface ConversationDiffFileItemProps {
  diff: ConversationFileDiff
  isExpanded: boolean
  onDiscardFile: (filePath: string) => Promise<void>
  onExpandedChange: (filePath: string, nextValue: boolean) => void
  onPreloadDiff: (diff: ConversationFileDiff) => Promise<void>
  onPrewarmDiff: (filePath: string) => void
  onStageFile: (filePath: string) => Promise<void>
  onUnstageFile: (filePath: string) => Promise<void>
  pendingFileActionPath: string | null
  selectedScope: DiffPanelScope
  shouldPrewarm: boolean
  onPrewarmReady: (filePath: string) => void
}

export type DiffPanelScope = 'branch' | 'last_turn' | 'staged' | 'unstaged'

const collapsedDiffFileRowStyle: CSSProperties = {
  contain: 'layout paint',
  height: CONVERSATION_DIFF_ROW_HEIGHT_PX,
}

const compactActionButtonClassName =
  'inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50'
const compactUnstageButtonClassName =
  'inline-flex h-7 w-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50'

interface DiffFileActionButtonsProps {
  diff: ConversationFileDiff
  isPending: boolean
  selectedScope: DiffPanelScope
  useTooltips: boolean
  onDiscardFile: (filePath: string) => Promise<void>
  onStageFile: (filePath: string) => Promise<void>
  onUnstageFile: (filePath: string) => Promise<void>
}

interface DiffFileActionButtonProps {
  ariaLabel: string
  className: string
  content: string
  disabled?: boolean
  icon: ReactElement
  useTooltips: boolean
  onClick: () => void
}

function DiffFileActionButton({
  ariaLabel,
  className,
  content,
  disabled = false,
  icon,
  useTooltips,
  onClick,
}: DiffFileActionButtonProps) {
  const button = (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()

        if (!disabled) {
          onClick()
        }
      }}
      className={className}
    >
      {icon}
    </button>
  )

  if (!useTooltips || disabled) {
    return button
  }

  return (
    <Tooltip content={content} side="left" noWrap>
      {button}
    </Tooltip>
  )
}

function DiffFileActionButtons({
  diff,
  isPending,
  selectedScope,
  useTooltips,
  onDiscardFile,
  onStageFile,
  onUnstageFile,
}: DiffFileActionButtonsProps) {
  if (selectedScope === 'staged') {
    return (
      <span className="inline-flex min-w-[2.25rem] items-center justify-end gap-0.5">
        <DiffFileActionButton
          ariaLabel={`Unstage ${diff.fileName}`}
          className={compactUnstageButtonClassName}
          content="Unstage file"
          disabled={isPending}
          icon={<Minus size={14} />}
          useTooltips={useTooltips}
          onClick={() => {
            void onUnstageFile(diff.fileName)
          }}
        />
      </span>
    )
  }

  return (
    <span className="inline-flex min-w-[4.5rem] items-center justify-end gap-0.5">
      <DiffFileActionButton
        ariaLabel={`Discard ${diff.fileName}`}
        className={compactActionButtonClassName}
        content="Discard changes"
        disabled={isPending}
        icon={<Undo2 size={14} />}
        useTooltips={useTooltips}
        onClick={() => {
          void onDiscardFile(diff.fileName)
        }}
      />
      <DiffFileActionButton
        ariaLabel={`Stage ${diff.fileName}`}
        className={compactActionButtonClassName}
        content="Stage file"
        disabled={isPending}
        icon={<Plus size={14} />}
        useTooltips={useTooltips}
        onClick={() => {
          void onStageFile(diff.fileName)
        }}
      />
    </span>
  )
}

interface CollapsedConversationDiffFileRowProps {
  diff: ConversationFileDiff
  isPending: boolean
  onDiscardFile: (filePath: string) => Promise<void>
  onExpand: () => void
  onPreloadDiff: (diff: ConversationFileDiff) => Promise<void>
  onPrewarmDiff: (filePath: string) => void
  onStageFile: (filePath: string) => Promise<void>
  onUnstageFile: (filePath: string) => Promise<void>
  selectedScope: DiffPanelScope
}

function CollapsedConversationDiffFileRow({
  diff,
  isPending,
  onDiscardFile,
  onExpand,
  onPreloadDiff,
  onPrewarmDiff,
  onStageFile,
  onUnstageFile,
  selectedScope,
}: CollapsedConversationDiffFileRowProps) {
  return (
    <div
      className="my-0 w-full overflow-hidden rounded-none border-0 border-b border-border bg-surface shadow-none"
      style={collapsedDiffFileRowStyle}
    >
      <DiffFileHeader
        filePath={diff.fileName}
        collapsible
        isExpanded={false}
        stableLayout
        onToggle={onExpand}
        onFocus={() => {
          void onPreloadDiff(diff)
          onPrewarmDiff(diff.fileName)
        }}
        onPointerEnter={() => {
          void onPreloadDiff(diff)
          onPrewarmDiff(diff.fileName)
        }}
        inlineContent={
          <span className="inline-flex items-center gap-1 text-xs leading-none">
            <span className="leading-none text-git-added">{`+${diff.addedLineCount}`}</span>
            <span className="leading-none text-git-removed">{`-${diff.removedLineCount}`}</span>
          </span>
        }
        rightContent={
          <DiffFileActionButtons
            diff={diff}
            isPending={isPending}
            selectedScope={selectedScope}
            useTooltips={false}
            onDiscardFile={onDiscardFile}
            onStageFile={onStageFile}
            onUnstageFile={onUnstageFile}
          />
        }
      />
    </div>
  )
}

function ConversationDiffFileItemComponent({
  diff,
  isExpanded,
  onDiscardFile,
  onExpandedChange,
  onPreloadDiff,
  onPrewarmDiff,
  onStageFile,
  onUnstageFile,
  pendingFileActionPath,
  selectedScope,
  shouldPrewarm,
  onPrewarmReady,
}: ConversationDiffFileItemProps) {
  const isPending = pendingFileActionPath === diff.fileName

  const handleExpandedChange = useCallback(
    (nextValue: boolean) => {
      onExpandedChange(diff.fileName, nextValue)
    },
    [diff.fileName, onExpandedChange],
  )
  const handlePrewarmReady = useCallback(() => {
    onPrewarmReady(diff.fileName)
  }, [diff.fileName, onPrewarmReady])

  if (!isExpanded && !shouldPrewarm) {
    return (
      <CollapsedConversationDiffFileRow
        diff={diff}
        isPending={isPending}
        onDiscardFile={onDiscardFile}
        onExpand={() => {
          onPrewarmDiff(diff.fileName)
          handleExpandedChange(true)
        }}
        onPreloadDiff={onPreloadDiff}
        onPrewarmDiff={onPrewarmDiff}
        onStageFile={onStageFile}
        onUnstageFile={onUnstageFile}
        selectedScope={selectedScope}
      />
    )
  }

  return (
    <>
      <DiffViewer
        stableHeaderLayout
        collapsible
        defaultExpanded={false}
        diffCacheKey={diff.contentSignature}
        filePath={diff.fileName}
        isExpanded={isExpanded}
        isContentLoading={diff.hasContent === false}
        newContent={diff.newContent}
        oldContent={diff.oldContent}
        prewarm={shouldPrewarm && !isExpanded}
        contextLines={diff.contextLines}
        layout="stacked"
        startLineNumber={diff.startLineNumber}
        onExpandedChange={handleExpandedChange}
        onPrewarmReady={handlePrewarmReady}
        headerInlineContent={
          <span className="inline-flex items-center gap-1 text-xs leading-none">
            <span className="leading-none text-git-added">{`+${diff.addedLineCount}`}</span>
            <span className="leading-none text-git-removed">{`-${diff.removedLineCount}`}</span>
          </span>
        }
        headerRightContent={
          <DiffFileActionButtons
            diff={diff}
            isPending={isPending}
            selectedScope={selectedScope}
            useTooltips
            onDiscardFile={onDiscardFile}
            onStageFile={onStageFile}
            onUnstageFile={onUnstageFile}
          />
        }
      />
      {!isExpanded ? (
        <CollapsedConversationDiffFileRow
          diff={diff}
          isPending={isPending}
          onDiscardFile={onDiscardFile}
          onExpand={() => {
            onPrewarmDiff(diff.fileName)
            handleExpandedChange(true)
          }}
          onPreloadDiff={onPreloadDiff}
          onPrewarmDiff={onPrewarmDiff}
          onStageFile={onStageFile}
          onUnstageFile={onUnstageFile}
          selectedScope={selectedScope}
        />
      ) : null}
    </>
  )
}

function areConversationDiffFileItemPropsEqual(
  left: ConversationDiffFileItemProps,
  right: ConversationDiffFileItemProps,
) {
  return (
    left.isExpanded === right.isExpanded &&
    left.pendingFileActionPath === right.pendingFileActionPath &&
    left.selectedScope === right.selectedScope &&
    left.diff.hasContent === right.diff.hasContent &&
    left.diff.fileName === right.diff.fileName &&
    left.onPreloadDiff === right.onPreloadDiff &&
    left.onPrewarmDiff === right.onPrewarmDiff &&
    left.shouldPrewarm === right.shouldPrewarm &&
    left.onPrewarmReady === right.onPrewarmReady &&
    left.diff.addedLineCount === right.diff.addedLineCount &&
    left.diff.removedLineCount === right.diff.removedLineCount &&
    left.diff.isDeleted === right.diff.isDeleted &&
    left.diff.isStaged === right.diff.isStaged &&
    left.diff.isUnstaged === right.diff.isUnstaged &&
    left.diff.isUntracked === right.diff.isUntracked &&
    left.diff.contentSignature === right.diff.contentSignature &&
    left.diff.contextLines === right.diff.contextLines &&
    left.diff.startLineNumber === right.diff.startLineNumber &&
    left.diff.newContent === right.diff.newContent &&
    left.diff.oldContent === right.diff.oldContent
  )
}

export const ConversationDiffFileItem = memo(
  ConversationDiffFileItemComponent,
  areConversationDiffFileItemPropsEqual,
)
