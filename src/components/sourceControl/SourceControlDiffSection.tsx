import type { ConversationFileDiff } from '../../lib/chatDiffs'
import { VirtualizedSourceControlDiffList } from './VirtualizedSourceControlDiffList'
import type { DiffPanelScope } from '../chat/ConversationDiffFileItem'

interface SourceControlDiffSectionProps {
  bodyClassName?: string
  areFileActionsDisabled: boolean
  diffs: readonly ConversationFileDiff[]
  emptyLabel: string
  pendingFileActionPath: string | null
  sectionClassName?: string
  scope: DiffPanelScope
  title: string
  onDiscardFile: (filePath: string) => Promise<void>
  onOpenDiffPanelForFile: (filePath: string, scope: DiffPanelScope) => void
  onStageFile: (filePath: string) => Promise<void>
  onUnstageFile: (filePath: string) => Promise<void>
}

export function SourceControlDiffSection({
  bodyClassName,
  areFileActionsDisabled,
  diffs,
  emptyLabel,
  pendingFileActionPath,
  sectionClassName,
  scope,
  title,
  onDiscardFile,
  onOpenDiffPanelForFile,
  onStageFile,
  onUnstageFile,
}: SourceControlDiffSectionProps) {
  return (
    <section className={['border-b border-border', sectionClassName ?? ''].join(' ').trim()}>
      {title.length > 0 ? (
        <div className="shrink-0 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{title}</div>
      ) : null}
      <VirtualizedSourceControlDiffList
        bodyClassName={bodyClassName}
        areFileActionsDisabled={areFileActionsDisabled}
        diffs={diffs}
        emptyLabel={emptyLabel}
        pendingFileActionPath={pendingFileActionPath}
        selectedScope={scope}
        onDiscardFile={onDiscardFile}
        onOpenDiffPanelForFile={onOpenDiffPanelForFile}
        onStageFile={onStageFile}
        onUnstageFile={onUnstageFile}
      />
    </section>
  )
}
