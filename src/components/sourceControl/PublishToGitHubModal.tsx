import { Github, GitBranch, Lock, Globe, X, Loader2, CheckCircle2, ExternalLink, AlertCircle, Eye, EyeOff, Key } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppSettings } from '../../hooks/useAppSettings'
import type { GitPublishInput } from '../../types/chat'

interface PublishToGitHubModalProps {
  workspacePath: string
  onClose: () => void
  onPublishSuccess: () => void
}

function getDefaultRepoName(workspacePath: string): string {
  const parts = workspacePath.replace(/\\/g, '/').split('/')
  const name = parts[parts.length - 1] ?? 'my-repo'
  // Sanitize: replace spaces with hyphens, strip invalid chars
  return name.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_.-]/g, '')
}

type PublishStep = 'form' | 'publishing' | 'success' | 'error'

export function PublishToGitHubModal({ workspacePath, onClose, onPublishSuccess }: PublishToGitHubModalProps) {
  const { settings, updateSettings } = useAppSettings()
  const [step, setStep] = useState<PublishStep>('form')
  const [repoName, setRepoName] = useState(getDefaultRepoName(workspacePath))
  const [description, setDescription] = useState('')
  const [defaultBranch, setDefaultBranch] = useState('main')
  const [isPrivate, setIsPrivate] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [repoUrl, setRepoUrl] = useState<string | null>(null)
  const [githubToken, setGithubToken] = useState(settings.githubToken ?? '')
  const [rememberToken, setRememberToken] = useState(true)
  const [showToken, setShowToken] = useState(false)
  const [isChangingToken, setIsChangingToken] = useState(false)
  const repoNameInputRef = useRef<HTMLInputElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (settings.githubToken && !githubToken) {
      setGithubToken(settings.githubToken)
    }
  }, [settings.githubToken])

  useEffect(() => {
    repoNameInputRef.current?.focus()
    repoNameInputRef.current?.select()
  }, [])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && step !== 'publishing') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, step])

  const handleOverlayClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.target === overlayRef.current && step !== 'publishing') {
        onClose()
      }
    },
    [onClose, step],
  )

  async function handlePublish() {
    const trimmedRepoName = repoName.trim()
    if (!trimmedRepoName) {
      setError('Repository name is required.')
      return
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(trimmedRepoName)) {
      setError('Repository name can only contain letters, numbers, hyphens, dots, and underscores.')
      return
    }

    const trimmedToken = (isChangingToken ? githubToken : settings.githubToken || githubToken).trim()
    if (!trimmedToken) {
      setError('GitHub Personal Access Token is required.')
      return
    }

    setStep('publishing')
    setError(null)

    const input: GitPublishInput = {
      workspacePath,
      repoName: trimmedRepoName,
      description: description.trim() || undefined,
      isPrivate,
      defaultBranch: defaultBranch.trim() || 'main',
      githubToken: trimmedToken,
    }

    try {
      const result = await window.echosphereGit.publishToGitHub(input)
      setRepoUrl(result.repoUrl)

      if (rememberToken && isChangingToken) {
        await updateSettings({ githubToken: trimmedToken })
      } else if (rememberToken && !settings.githubToken) {
        await updateSettings({ githubToken: trimmedToken })
      }

      setStep('success')
      onPublishSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to publish to GitHub.')
      setStep('error')
    }
  }

  function handleOpenRepo() {
    if (repoUrl) {
      window.open(repoUrl, '_blank')
    }
  }

  const currentToken = isChangingToken ? githubToken : settings.githubToken || githubToken
  const isFormValid = repoName.trim().length > 0 && currentToken.trim().length > 0

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      style={{ animation: 'fadeIn 0.15s ease-out' }}
    >
      <div
        className="relative mx-4 w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
        style={{ animation: 'slideUp 0.2s ease-out' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#24292e] text-white shadow-sm">
              <Github size={18} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Publish to GitHub</h2>
              <p className="text-xs text-muted-foreground">Create a new repository on GitHub</p>
            </div>
          </div>
          {step !== 'publishing' && (
            <button
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Content */}
        {step === 'form' || step === 'error' ? (
          <div className="px-6 py-5 space-y-4">
            {/* GitHub Authentication */}
            <div className="space-y-1.5 rounded-xl border border-border/60 bg-surface-muted/30 p-3.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground flex items-center gap-1.5 select-none">
                  <Key size={13} className="text-blue-500" />
                  GitHub Authentication
                </span>
                {!!settings.githubToken && !isChangingToken && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsChangingToken(true)
                      setGithubToken('')
                    }}
                    className="text-[11px] font-medium text-blue-500 hover:text-blue-600 transition-colors cursor-pointer"
                  >
                    Change Token
                  </button>
                )}
              </div>

              {settings.githubToken && !isChangingToken ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-2.5 mt-1.5">
                  <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                  <span>Authenticated via saved Personal Access Token</span>
                </div>
              ) : (
                <div className="space-y-2 mt-1.5">
                  <div className="relative flex items-center">
                    <input
                      id="publish-github-token"
                      type={showToken ? 'text' : 'password'}
                      value={githubToken}
                      onChange={(e) => {
                        setGithubToken(e.target.value)
                        if (step === 'error') setStep('form')
                        setError(null)
                      }}
                      placeholder="Enter GitHub Personal Access Token (PAT)..."
                      className="w-full rounded-lg border border-border bg-surface-muted pl-3 pr-10 py-2 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
                    />
                    <button
                      type="button"
                      onClick={() => setShowToken(!showToken)}
                      className="absolute right-3 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    >
                      {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <label className="flex items-center gap-1.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={rememberToken}
                        onChange={(e) => setRememberToken(e.target.checked)}
                        className="rounded border-border bg-surface-muted text-blue-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                      />
                      Remember token in Settings
                    </label>
                    <a
                      href="https://github.com/settings/tokens/new?scopes=repo&description=Echosphere"
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-500 hover:text-blue-600 underline underline-offset-2 flex items-center gap-0.5"
                    >
                      Generate Token <ExternalLink size={10} />
                    </a>
                  </div>
                </div>
              )}
            </div>

            {/* Repo name */}
            <div className="space-y-1.5">
              <label htmlFor="publish-repo-name" className="block text-xs font-medium text-foreground">
                Repository Name <span className="text-red-500">*</span>
              </label>
              <input
                id="publish-repo-name"
                ref={repoNameInputRef}
                type="text"
                value={repoName}
                onChange={(e) => {
                  setRepoName(e.target.value)
                  if (step === 'error') setStep('form')
                  setError(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && isFormValid) void handlePublish()
                }}
                placeholder="my-awesome-project"
                className="w-full rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
              />
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <label htmlFor="publish-description" className="block text-xs font-medium text-foreground">
                Description <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <input
                id="publish-description"
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="A short description of your project"
                className="w-full rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
              />
            </div>

            {/* Default branch */}
            <div className="space-y-1.5">
              <label htmlFor="publish-branch" className="block text-xs font-medium text-foreground">
                <GitBranch size={12} className="inline mr-1 -mt-0.5" />
                Default Branch
              </label>
              <input
                id="publish-branch"
                type="text"
                value={defaultBranch}
                onChange={(e) => setDefaultBranch(e.target.value)}
                placeholder="main"
                className="w-full rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
              />
            </div>

            {/* Visibility */}
            <div className="space-y-2">
              <span className="block text-xs font-medium text-foreground">Visibility</span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setIsPrivate(false)}
                  className={[
                    'flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm transition-all cursor-pointer',
                    !isPrivate
                      ? 'border-blue-500 bg-blue-500/10 text-foreground ring-1 ring-blue-500/30'
                      : 'border-border bg-surface-muted text-muted-foreground hover:border-border/80 hover:text-foreground',
                  ].join(' ')}
                >
                  <Globe size={14} className={!isPrivate ? 'text-blue-500' : 'text-muted-foreground'} />
                  <div>
                    <div className="font-medium text-xs">Public</div>
                    <div className="text-[10px] text-muted-foreground">Anyone can see</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setIsPrivate(true)}
                  className={[
                    'flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm transition-all cursor-pointer',
                    isPrivate
                      ? 'border-blue-500 bg-blue-500/10 text-foreground ring-1 ring-blue-500/30'
                      : 'border-border bg-surface-muted text-muted-foreground hover:border-border/80 hover:text-foreground',
                  ].join(' ')}
                >
                  <Lock size={14} className={isPrivate ? 'text-blue-500' : 'text-muted-foreground'} />
                  <div>
                    <div className="font-medium text-xs">Private</div>
                    <div className="text-[10px] text-muted-foreground">Only you can see</div>
                  </div>
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5">
                <AlertCircle size={14} className="mt-0.5 shrink-0 text-red-500" />
                <p className="text-xs text-red-600 dark:text-red-400 leading-relaxed">{error}</p>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handlePublish}
                disabled={!isFormValid}
                className="flex items-center gap-2 rounded-lg bg-[#24292e] px-4 py-2 text-sm font-medium text-white transition-all hover:bg-[#1a1f23] disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98] cursor-pointer"
              >
                <Github size={14} />
                Publish to GitHub
              </button>
            </div>
          </div>
        ) : step === 'publishing' ? (
          <div className="flex flex-col items-center justify-center px-6 py-12 space-y-4">
            <div className="relative">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#24292e] text-white shadow-lg">
                <Github size={24} />
              </div>
              <div className="absolute -right-1 -bottom-1 flex h-6 w-6 items-center justify-center rounded-full bg-surface border border-border">
                <Loader2 size={12} className="animate-spin text-blue-500" />
              </div>
            </div>
            <div className="text-center space-y-1">
              <p className="text-sm font-medium text-foreground">Publishing to GitHub…</p>
              <p className="text-xs text-muted-foreground">Creating repository and pushing your code</p>
            </div>
          </div>
        ) : (
          /* success */
          <div className="flex flex-col items-center justify-center px-6 py-10 space-y-5">
            <div className="relative">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#24292e] text-white shadow-lg">
                <Github size={24} />
              </div>
              <div className="absolute -right-1 -bottom-1 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 shadow">
                <CheckCircle2 size={14} className="text-white" />
              </div>
            </div>
            <div className="text-center space-y-1">
              <p className="text-sm font-semibold text-foreground">Published Successfully!</p>
              <p className="text-xs text-muted-foreground">
                Your repository is now live on GitHub
              </p>
            </div>
            {repoUrl && (
              <button
                type="button"
                onClick={handleOpenRepo}
                className="flex items-center gap-2 rounded-lg border border-border bg-surface-muted px-4 py-2.5 text-sm text-foreground transition-colors hover:bg-surface-muted/80"
              >
                <ExternalLink size={13} />
                Open on GitHub
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="text-xs text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
            >
              Close
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(12px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  )
}
