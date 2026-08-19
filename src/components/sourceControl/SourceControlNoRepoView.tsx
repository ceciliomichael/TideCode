import { GitBranch, FolderGit2, Globe, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'
import { useState } from 'react'
import type { GitCommitModelSelection } from '../../types/chat'
import { PublishToGitHubModal } from './PublishToGitHubModal'

interface SourceControlNoRepoViewProps {
  commitModelSelection: GitCommitModelSelection
  workspacePath: string
  onRefreshAll: () => Promise<void>
}

type InitStep = 'idle' | 'loading' | 'success' | 'error'

export function SourceControlNoRepoView({ commitModelSelection, workspacePath, onRefreshAll }: SourceControlNoRepoViewProps) {
  const [initStep, setInitStep] = useState<InitStep>('idle')
  const [initError, setInitError] = useState<string | null>(null)
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false)

  async function handleInitRepo() {
    if (initStep === 'loading') return
    setInitStep('loading')
    setInitError(null)

    try {
      await window.tidecodeGit.initRepository(workspacePath)
      setInitStep('success')
      // Small delay for the success state to be visible, then refresh
      await new Promise((resolve) => setTimeout(resolve, 600))
      await onRefreshAll()
    } catch (err) {
      setInitError(err instanceof Error ? err.message : 'Failed to initialize repository.')
      setInitStep('error')
    }
  }

  function handlePublishSuccess() {
    void onRefreshAll()
  }

  const folderName = workspacePath
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .at(-1) ?? 'this folder'

  return (
    <>
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-10">
        {/* Icon */}
        <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-surface-muted shadow-sm">
          <FolderGit2 size={28} className="text-muted-foreground" />
          <div className="absolute -right-1.5 -bottom-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-surface border border-border shadow-sm">
            <GitBranch size={12} className="text-muted-foreground" />
          </div>
        </div>

        {/* Text */}
        <div className="text-center space-y-1.5 max-w-[240px]">
          <p className="text-sm font-semibold text-foreground">No Repository Found</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            <span className="font-medium text-foreground/80 break-all">{folderName}</span>
            {' '}is not a Git repository. Initialize one to start tracking changes.
          </p>
        </div>

        {/* Error message */}
        {(initStep === 'error' && initError) && (
          <div className="w-full flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5">
            <AlertCircle size={13} className="mt-0.5 shrink-0 text-red-500" />
            <p className="text-xs text-red-600 dark:text-red-400 leading-relaxed">{initError}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex w-full flex-col gap-2.5">
          {/* Initialize Repository */}
          <button
            type="button"
            id="sc-init-repo-button"
            onClick={handleInitRepo}
            disabled={initStep === 'loading' || initStep === 'success'}
            className={[
              'group relative flex w-full items-center justify-center gap-2.5 overflow-hidden rounded-xl border px-4 py-3 text-sm font-medium transition-all duration-200',
              initStep === 'success'
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : initStep === 'loading'
                  ? 'border-border bg-surface-muted text-muted-foreground cursor-wait'
                  : 'border-border bg-surface-muted text-foreground hover:bg-surface hover:border-border/80 active:scale-[0.98] cursor-pointer',
            ].join(' ')}
          >
            {/* Shimmer effect on hover */}
            {initStep === 'idle' && (
              <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/5 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
            )}

            {initStep === 'loading' ? (
              <Loader2 size={15} className="animate-spin text-brand" />
            ) : initStep === 'success' ? (
              <CheckCircle2 size={15} className="text-emerald-500" />
            ) : (
              <GitBranch size={15} className="text-muted-foreground group-hover:text-foreground transition-colors" />
            )}
            {initStep === 'loading'
              ? 'Initializing…'
              : initStep === 'success'
                ? 'Repository initialized!'
                : 'Initialize Repository'}
          </button>

          {/* Publish Repository */}
          <button
            type="button"
            id="sc-publish-github-button"
            onClick={() => setIsPublishModalOpen(true)}
            disabled={initStep === 'loading'}
            className={[
              'group relative flex w-full items-center justify-center gap-2.5 overflow-hidden rounded-xl border px-4 py-3 text-sm font-medium transition-all duration-200',
              initStep === 'loading'
                ? 'cursor-not-allowed border-border bg-surface-muted text-muted-foreground opacity-50'
                : 'cursor-pointer border-border bg-surface-muted text-foreground hover:bg-surface hover:border-border/80 active:scale-[0.98]',
            ].join(' ')}
          >
            <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/5 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
            <Globe size={15} className="text-muted-foreground group-hover:text-foreground transition-colors" />
            <span>Publish Repository</span>
          </button>
        </div>

        {/* Hint */}
        <p className="text-center text-[11px] text-muted-foreground leading-relaxed max-w-[220px]">
          Initialize locally, or publish directly to GitLab, Bitbucket, GitHub, or any remote Git server.
        </p>
      </div>

      {isPublishModalOpen && (
        <PublishToGitHubModal
          commitModelSelection={commitModelSelection}
          workspacePath={workspacePath}
          onClose={() => setIsPublishModalOpen(false)}
          onPublishSuccess={handlePublishSuccess}
        />
      )}
    </>
  )
}
