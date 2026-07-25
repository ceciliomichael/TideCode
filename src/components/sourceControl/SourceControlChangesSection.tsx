import { ChevronDown, Loader2 } from 'lucide-react'
import type { RefObject } from 'react'
import { useState } from 'react'
import type { ConversationFileDiff } from '../../lib/chatDiffs'
import type { DiffPanelScope } from '../chat/ConversationDiffFileItem'
import { Tooltip } from '../Tooltip'
import { Switch } from '../ui/Switch'
import { SourceControlDiffSection } from './SourceControlDiffSection'
import { PublishToGitHubModal } from './PublishToGitHubModal'
import { SourceControlSyncButton } from './SourceControlSyncButton'

interface SourceControlChangesSectionProps {
  commitActionControlsRef: RefObject<HTMLDivElement>
  commitMessage: string
  hasRemote: boolean
  includeUnstaged: boolean
  isChangesSectionOpen: boolean
  isCommitActionDisabled: boolean
  isCommitActionMenuOpen: boolean
  isCommitPrimaryBusy: boolean
  isQuickCommitting: boolean
  isSyncingChanges: boolean
  isStagedSectionOpen: boolean
  isUnstagedSectionOpen: boolean
  isOperationInProgress: boolean
  pendingFileActionPath: string | null
  pendingOperationLabel: string | null
  quickCommitError: string | null
  stagedFileCount: number
  stagedFileDiffs: readonly ConversationFileDiff[]
  syncError: string | null
  syncMessage: string | null
  unstagedFileCount: number
  unstagedFileDiffs: readonly ConversationFileDiff[]
  workspacePath: string
  onCommitActionMenuOpenChange: (nextValue: boolean) => void
  onCommitMessageChange: (nextValue: string) => void
  onDiscardFiles: (filePaths: string[]) => Promise<void>
  onDiscardFile: (filePath: string) => Promise<void>
  onIncludeUnstagedChange: (nextValue: boolean) => void
  onOpenCommitModal: () => void
  onOpenDiffPanelForFile: (filePath: string, scope: DiffPanelScope) => void
  onPublishSuccess: () => Promise<void>
  onQuickCommitSubmit: (action?: 'commit' | 'commit-and-push') => Promise<void>
  onSyncChanges: () => Promise<void>
  onStageFiles: (filePaths: string[]) => Promise<void>
  onStageFile: (filePath: string) => Promise<void>
  onStagedSectionOpenChange: (nextValue: boolean) => void
  onToggleChangesSection: () => void
  onUnstageFiles: (filePaths: string[]) => Promise<void>
  onUnstageFile: (filePath: string) => Promise<void>
  onUnstagedSectionOpenChange: (nextValue: boolean) => void
}


export function SourceControlChangesSection({
  commitActionControlsRef,
  commitMessage,
  hasRemote,
  includeUnstaged,
  isChangesSectionOpen,
  isCommitActionDisabled,
  isCommitActionMenuOpen,
  isCommitPrimaryBusy,
  isQuickCommitting,
  isSyncingChanges,
  isStagedSectionOpen,
  isUnstagedSectionOpen,
  isOperationInProgress,
  pendingFileActionPath,
  pendingOperationLabel,
  quickCommitError,
  stagedFileCount,
  stagedFileDiffs,
  syncError,
  syncMessage,
  unstagedFileCount,
  unstagedFileDiffs,
  workspacePath,
  onCommitActionMenuOpenChange,
  onCommitMessageChange,
  onDiscardFiles,
  onDiscardFile,
  onIncludeUnstagedChange,
  onOpenCommitModal,
  onOpenDiffPanelForFile,
  onPublishSuccess,
  onQuickCommitSubmit,
  onSyncChanges,
  onStageFiles,
  onStageFile,
  onStagedSectionOpenChange,
  onToggleChangesSection,
  onUnstageFiles,
  onUnstageFile,
  onUnstagedSectionOpenChange,
}: SourceControlChangesSectionProps) {
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false)
  const sectionBodyClassName = 'min-h-0 flex flex-1 flex-col overflow-hidden'

  const diffViewportClassName = 'min-h-0 flex-1 overflow-y-auto'
  const hasStagedSection = stagedFileDiffs.length > 0
  const shouldShowUnstagedSectionTopBorder = hasStagedSection && isStagedSectionOpen
  const stagedBadgeClassName =
    stagedFileCount < 10
      ? 'grid h-5 w-5 flex-none place-items-center rounded-full bg-border-muted text-[10px] font-medium leading-none text-foreground'
      : 'inline-flex h-5 min-w-5 flex-none items-center justify-center rounded-full bg-border-muted px-1.5 text-[10px] font-medium leading-none text-foreground'
  const unstagedBadgeClassName =
    unstagedFileCount < 10
      ? 'grid h-5 w-5 flex-none place-items-center rounded-full bg-border-muted text-[10px] font-medium leading-none text-foreground'
      : 'inline-flex h-5 min-w-5 flex-none items-center justify-center rounded-full bg-border-muted px-1.5 text-[10px] font-medium leading-none text-foreground'
  const singleDigitBadgeValueClassName = 'tabular-nums translate-x-[1px]'
  const stagedFilePaths = Array.from(new Set(stagedFileDiffs.map((fileDiff) => fileDiff.fileName)))
  const unstagedFilePaths = Array.from(new Set(unstagedFileDiffs.map((fileDiff) => fileDiff.fileName)))
  const isBulkStageActionDisabled = isOperationInProgress || unstagedFilePaths.length === 0
  const isBulkUnstageActionDisabled = isOperationInProgress || stagedFilePaths.length === 0
  const shouldShowSyncChanges = hasRemote && stagedFileCount === 0 && unstagedFileCount === 0

  async function handleStageAllUnstagedFiles() {
    if (unstagedFilePaths.length === 0) {
      return
    }

    await onStageFiles(unstagedFilePaths)
  }

  async function handleDiscardAllUnstagedFiles() {
    if (unstagedFilePaths.length === 0) {
      return
    }

    await onDiscardFiles(unstagedFilePaths)
  }

  async function handleUnstageAllStagedFiles() {
    if (stagedFilePaths.length === 0) {
      return
    }

    await onUnstageFiles(stagedFilePaths)
  }

  return (
    <>
    <section
      className={[
        'border-b border-border',
        isChangesSectionOpen ? 'min-h-0 flex flex-1 flex-col' : 'shrink-0',
      ].join(' ')}
    >

      <button type="button" onClick={onToggleChangesSection} className="flex h-10 w-full items-center justify-between px-4 text-left">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Changes</span>
        <ChevronDown size={13} className={['text-muted-foreground transition-transform', isChangesSectionOpen ? '' : '-rotate-90'].join(' ')} />
      </button>
      {isChangesSectionOpen ? (
        <div className={[sectionBodyClassName, 'border-t border-border'].join(' ')}>
          {pendingOperationLabel ? (
            <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface-muted px-4 py-2 text-[12px] text-muted-foreground">
              <Loader2 size={13} className="animate-spin" />
              <span>{pendingOperationLabel}</span>
            </div>
          ) : null}
          <div className="shrink-0 border-b border-border px-4 py-3">
            {shouldShowSyncChanges ? (
              <SourceControlSyncButton
                disabled={isOperationInProgress}
                isSyncing={isSyncingChanges}
                onSync={onSyncChanges}
              />
            ) : (
              <>
                <textarea
                  value={commitMessage}
                  onChange={(event) => onCommitMessageChange(event.target.value)}
                  rows={3}
                  placeholder="Commit message (leave empty to auto-generate with AI)"
                  className="w-full resize-none rounded-xl border border-border bg-surface-muted px-3 py-2 text-sm text-foreground outline-none placeholder:text-subtle-foreground"
                />

                <div className="mt-2 flex items-center justify-between gap-2">
                  <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                    <Switch checked={includeUnstaged} onChange={onIncludeUnstagedChange} disabled={isOperationInProgress} />
                    Include unstaged
                  </label>

                  <div className="inline-flex items-center gap-1.5">
                    <div ref={commitActionControlsRef} className="relative inline-flex items-center">
                      <button
                        type="button"
                        disabled={isCommitActionDisabled}
                        onClick={() => void onQuickCommitSubmit('commit')}
                        className={[
                          'inline-flex h-8 min-w-[66px] items-center justify-center rounded-l-lg rounded-r-none pl-2 text-xs font-medium transition-colors',
                          isCommitPrimaryBusy ? 'pr-2' : 'pr-1',
                          isCommitActionDisabled ? 'chat-send-button-disabled cursor-not-allowed' : 'chat-send-button-enabled',
                        ].join(' ')}
                      >
                        {isQuickCommitting ? 'Committing' : isCommitPrimaryBusy ? 'Pushing' : 'Commit'}
                      </button>
                      <button
                        type="button"
                        aria-label="Commit actions"
                        aria-haspopup="menu"
                        aria-expanded={isCommitActionMenuOpen}
                        disabled={isCommitActionDisabled}
                        onClick={() => {
                          onCommitActionMenuOpenChange(!isCommitActionMenuOpen)
                        }}
                        className={[
                          'inline-flex h-8 w-8 items-center justify-center rounded-l-none rounded-r-lg border-l border-white/15 text-xs transition-colors',
                          isCommitActionDisabled ? 'chat-send-button-disabled cursor-not-allowed' : 'chat-send-button-enabled',
                        ].join(' ')}
                      >
                        <ChevronDown size={13} />
                      </button>
                      {isCommitActionMenuOpen ? (
                        <div
                          role="menu"
                          aria-label="Commit actions"
                          className="absolute right-0 top-[calc(100%+6px)] z-40 min-w-[160px] overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-soft"
                        >
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => void onQuickCommitSubmit('commit')}
                            className="flex h-9 w-full items-center rounded-lg px-2.5 text-left text-xs text-foreground transition-colors hover:bg-surface-muted"
                          >
                            Commit
                          </button>
                          {hasRemote ? (
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => void onQuickCommitSubmit('commit-and-push')}
                              className="flex h-9 w-full items-center rounded-lg px-2.5 text-left text-xs text-foreground transition-colors hover:bg-surface-muted"
                            >
                              Commit and push
                            </button>
                          ) : (
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                onCommitActionMenuOpenChange(false)
                                setIsPublishModalOpen(true)
                              }}
                              className="flex h-9 w-full items-center rounded-lg px-2.5 text-left text-xs text-foreground transition-colors hover:bg-surface-muted"
                            >
                              Publish to GitHub
                            </button>
                          )}
                        </div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={onOpenCommitModal}
                      disabled={isOperationInProgress}
                      className={[
                        'inline-flex h-8 items-center justify-center rounded-lg px-3 text-xs font-medium transition-colors',
                        isOperationInProgress ? 'chat-send-button-disabled cursor-not-allowed' : 'chat-send-button-enabled',
                      ].join(' ')}
                    >
                      Advanced
                    </button>
                  </div>
                </div>
              </>
            )}

            {quickCommitError ? <p className="mt-2 text-xs text-danger-foreground">{quickCommitError}</p> : null}
            {syncError ? <p className="mt-2 text-xs text-danger-foreground">{syncError}</p> : null}
            {!syncError && syncMessage ? <p className="mt-2 text-xs text-muted-foreground">{syncMessage}</p> : null}
          </div>

          <div className={sectionBodyClassName}>
            {stagedFileDiffs.length > 0 ? (
              <section className={['min-h-0 flex flex-col', isStagedSectionOpen ? 'flex-1' : 'shrink-0'].join(' ')}>
                <div className="flex h-10 w-full items-center border-b border-border">
                  <button
                    type="button"
                    onClick={() => onStagedSectionOpenChange(!isStagedSectionOpen)}
                    className="flex flex-1 items-center justify-between px-4 text-left"
                  >
                    <span className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      <span>Staged Changes</span>
                      <span className={stagedBadgeClassName}>
                        <span className={singleDigitBadgeValueClassName}>{stagedFileCount}</span>
                      </span>
                    </span>
                  </button>
                  <div className="flex items-center gap-2 pr-3">
                    <Tooltip content="Unstage all staged files" side="left">
                      <button
                        type="button"
                        aria-label="Unstage all staged files"
                        disabled={isBulkUnstageActionDisabled}
                        onClick={() => void handleUnstageAllStagedFiles()}
                        className={[
                          'inline-flex h-7 items-center justify-center px-2 text-xs font-medium',
                          isBulkUnstageActionDisabled
                            ? 'cursor-not-allowed text-muted-foreground/60'
                            : 'text-muted-foreground hover:text-foreground',
                        ].join(' ')}
                      >
                        <span>
                          Unstage all
                        </span>
                      </button>
                    </Tooltip>
                    <ChevronDown
                      size={13}
                      className={['text-muted-foreground transition-transform', isStagedSectionOpen ? '' : '-rotate-90'].join(' ')}
                    />
                  </div>
                </div>
                {isStagedSectionOpen ? (
                  <SourceControlDiffSection
                    bodyClassName={diffViewportClassName}
                    areFileActionsDisabled={isOperationInProgress}
                    sectionClassName="border-b-0 min-h-0 flex flex-1 flex-col"
                    title=""
                    scope="staged"
                    diffs={stagedFileDiffs}
                    emptyLabel="No staged files."
                    pendingFileActionPath={pendingFileActionPath}
                    onDiscardFile={onDiscardFile}
                    onOpenDiffPanelForFile={onOpenDiffPanelForFile}
                    onStageFile={onStageFile}
                    onUnstageFile={onUnstageFile}
                  />
                ) : null}
              </section>
            ) : null}

            {unstagedFileDiffs.length > 0 ? (
              <section
                className={[
                  'min-h-0 flex flex-col',
                  isUnstagedSectionOpen ? 'flex-1' : 'shrink-0',
                  shouldShowUnstagedSectionTopBorder ? 'border-t border-border' : '',
                ].join(' ')}
              >
                <div className="flex h-10 w-full items-center border-b border-border">
                  <button
                    type="button"
                    onClick={() => onUnstagedSectionOpenChange(!isUnstagedSectionOpen)}
                    className="flex flex-1 items-center justify-between px-4 text-left"
                  >
                    <span className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      <span>Changes</span>
                      <span className={unstagedBadgeClassName}>
                        <span className={singleDigitBadgeValueClassName}>{unstagedFileCount}</span>
                      </span>
                    </span>
                  </button>
                  <div className="flex items-center gap-2 pr-3">
                    <Tooltip content="Stage all unstaged files" side="left">
                      <button
                        type="button"
                        aria-label="Stage all unstaged files"
                        disabled={isBulkStageActionDisabled}
                        onClick={() => void handleStageAllUnstagedFiles()}
                        className={[
                          'inline-flex h-7 items-center justify-center px-2 text-xs font-medium',
                          isBulkStageActionDisabled
                            ? 'cursor-not-allowed text-muted-foreground/60'
                            : 'text-muted-foreground hover:text-foreground',
                        ].join(' ')}
                      >
                        <span>
                          Stage all
                        </span>
                      </button>
                    </Tooltip>
                    <Tooltip content="Discard all unstaged files" side="left">
                      <button
                        type="button"
                        aria-label="Discard all unstaged files"
                        disabled={isBulkStageActionDisabled}
                        onClick={() => void handleDiscardAllUnstagedFiles()}
                        className={[
                          'inline-flex h-7 items-center justify-center px-2 text-xs font-medium',
                          isBulkStageActionDisabled
                            ? 'cursor-not-allowed text-muted-foreground/60'
                            : 'text-muted-foreground hover:text-foreground',
                        ].join(' ')}
                      >
                        <span>
                          Discard all
                        </span>
                      </button>
                    </Tooltip>
                    <ChevronDown
                      size={13}
                      className={['text-muted-foreground transition-transform', isUnstagedSectionOpen ? '' : '-rotate-90'].join(' ')}
                    />
                  </div>
                </div>
                {isUnstagedSectionOpen ? (
                  <SourceControlDiffSection
                    bodyClassName={diffViewportClassName}
                    areFileActionsDisabled={isOperationInProgress}
                    sectionClassName="border-b-0 min-h-0 flex flex-1 flex-col"
                    title=""
                    scope="unstaged"
                    diffs={unstagedFileDiffs}
                    emptyLabel="No unstaged files."
                    pendingFileActionPath={pendingFileActionPath}
                    onDiscardFile={onDiscardFile}
                    onOpenDiffPanelForFile={onOpenDiffPanelForFile}
                    onStageFile={onStageFile}
                    onUnstageFile={onUnstageFile}
                  />
                ) : null}
              </section>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>

    {isPublishModalOpen && workspacePath ? (
      <PublishToGitHubModal
        workspacePath={workspacePath}
        onClose={() => setIsPublishModalOpen(false)}
        onPublishSuccess={onPublishSuccess}
      />
    ) : null}
  </>
  )
}

