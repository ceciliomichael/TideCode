import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  GitBranch,
  Globe,
  Github,
  Loader2,
  Lock,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { GitHubAuthStatus, GitHubDeviceLoginResult, GitPublishInput } from '../../types/chat'

interface PublishToGitHubModalProps {
  workspacePath: string
  onClose: () => void
  onPublishSuccess: () => void
}

function getDefaultRepoName(workspacePath: string): string {
  const parts = workspacePath.replace(/\\/g, '/').split('/')
  const name = parts[parts.length - 1] ?? 'my-repo'
  return name.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 100)
}

function isValidRepositoryName(repoName: string) {
  return /^[a-zA-Z0-9](?:[a-zA-Z0-9_.-]*[a-zA-Z0-9])?$/u.test(repoName) && repoName.length <= 100
}

type PublishStep = 'form' | 'publishing' | 'success' | 'error'

export function PublishToGitHubModal({ workspacePath, onClose, onPublishSuccess }: PublishToGitHubModalProps) {
  const [step, setStep] = useState<PublishStep>('form')
  const [repoName, setRepoName] = useState(getDefaultRepoName(workspacePath))
  const [description, setDescription] = useState('')
  const [defaultBranch, setDefaultBranch] = useState('main')
  const [isPrivate, setIsPrivate] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [repoUrl, setRepoUrl] = useState<string | null>(null)
  const [authStatus, setAuthStatus] = useState<GitHubAuthStatus | null>(null)
  const [isCheckingAuth, setIsCheckingAuth] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [deviceLogin, setDeviceLogin] = useState<GitHubDeviceLoginResult | null>(null)
  const repoNameInputRef = useRef<HTMLInputElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  const refreshAuthStatus = useCallback(async () => {
    setIsCheckingAuth(true)
    try {
      setAuthStatus(await window.tidecodeGit.getGitHubAuthStatus())
    } catch (authError) {
      setAuthStatus({
        kind: 'not-authenticated',
        message: authError instanceof Error ? authError.message : 'Could not check GitHub sign-in status.',
      })
    } finally {
      setIsCheckingAuth(false)
    }
  }, [])

  useEffect(() => {
    void refreshAuthStatus()
    repoNameInputRef.current?.focus()
    repoNameInputRef.current?.select()
  }, [refreshAuthStatus])

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

  async function handleConnectGitHub() {
    setIsConnecting(true)
    setError(null)
    setDeviceLogin(null)

    try {
      const login = await window.tidecodeGit.connectGitHub()
      setDeviceLogin(login)
      const nextAuthStatus = await window.tidecodeGit.completeGitHubDeviceLogin()
      setAuthStatus(nextAuthStatus)
      if (nextAuthStatus.kind !== 'authenticated') {
        setError(nextAuthStatus.message)
      }
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : 'Could not connect to GitHub.')
    } finally {
      setIsConnecting(false)
    }
  }

  async function handlePublish() {
    const trimmedRepoName = repoName.trim()
    if (!trimmedRepoName) {
      setError('Repository name is required.')
      return
    }
    if (!isValidRepositoryName(trimmedRepoName)) {
      setError('Repository name can only contain letters, numbers, hyphens, dots, and underscores, and must be 100 characters or fewer.')
      return
    }
    if (authStatus?.kind !== 'authenticated') {
      setError(authStatus?.message ?? 'GitHub sign-in is still being checked. Try again in a moment.')
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
    }

    try {
      const result = await window.tidecodeGit.publishToGitHub(input)
      setRepoUrl(result.repoUrl)
      setStep('success')
      onPublishSuccess()
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : 'Failed to publish to GitHub.')
      setStep('error')
      await refreshAuthStatus()
    }
  }

  function handleOpenRepo() {
    if (repoUrl) {
      window.open(repoUrl, '_blank', 'noopener,noreferrer')
    }
  }

  const isFormValid =
    repoName.trim().length > 0 &&
    isValidRepositoryName(repoName.trim()) &&
    authStatus?.kind === 'authenticated' &&
    !isCheckingAuth &&
    !isConnecting

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-3"
      style={{ animation: 'fadeIn 0.15s ease-out' }}
    >
      <div
        className="relative max-h-[calc(100vh-24px)] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-surface shadow-2xl"
        style={{ animation: 'slideUp 0.2s ease-out' }}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#24292e] text-white shadow-sm">
              <Github size={18} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Publish to GitHub</h2>
              <p className="text-xs text-muted-foreground">Create a new repository and push this folder</p>
            </div>
          </div>
          {step !== 'publishing' && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close publish dialog"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {step === 'form' || step === 'error' ? authStatus?.kind !== 'authenticated' ? (
          <div className="flex flex-col items-center gap-4 px-6 py-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-surface-muted">
              <Github size={23} className="text-foreground" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-foreground">Connect to GitHub</h3>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Sign in with GitHub to create the repository and push your local commits.
              </p>
            </div>

            {isCheckingAuth && !authStatus ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 size={13} className="animate-spin text-brand" />
                Checking your GitHub connection…
              </div>
            ) : isConnecting ? (
              <div className="w-full space-y-3 rounded-xl border border-border bg-surface-muted/40 p-3.5">
                <div className="flex items-center justify-center gap-2 text-xs font-medium text-foreground">
                  <Loader2 size={13} className="animate-spin text-brand" />
                  Waiting for GitHub authorization…
                </div>
                {deviceLogin ? (
                  <>
                    <p className="text-xs text-muted-foreground">A browser window was opened. If needed, enter this code at GitHub:</p>
                    <p className="font-mono text-lg font-semibold tracking-[0.18em] text-foreground">{deviceLogin.userCode}</p>
                    <a
                      href={deviceLogin.verificationUri}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-brand underline underline-offset-2"
                    >
                      Open GitHub sign-in <ExternalLink size={11} />
                    </a>
                  </>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                {error ? (
                  <div className="inline-flex max-w-[22rem] items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-center">
                    <AlertCircle size={14} className="mt-0.5 shrink-0 text-red-500" aria-hidden="true" />
                    <p className="text-xs leading-relaxed text-red-600 dark:text-red-400">{error}</p>
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => void handleConnectGitHub()}
                  className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#24292e] px-4 text-xs font-medium text-white transition-colors hover:bg-[#1a1f23]"
                >
                  <Github size={14} />
                  Connect to GitHub
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4 px-6 py-5">
            <div className="space-y-1.5">
              <label htmlFor="publish-repo-name" className="block text-xs font-medium text-foreground">
                Repository name <span className="text-red-500">*</span>
              </label>
              <input
                id="publish-repo-name"
                ref={repoNameInputRef}
                type="text"
                value={repoName}
                maxLength={100}
                onChange={(event) => {
                  setRepoName(event.target.value)
                  if (step === 'error') setStep('form')
                  setError(null)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && isFormValid) void handlePublish()
                }}
                placeholder="my-awesome-project"
                className="w-full rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:outline-none focus:ring-0"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="publish-description" className="block text-xs font-medium text-foreground">
                Description <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <input
                id="publish-description"
                type="text"
                value={description}
                maxLength={350}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="A short description of your project"
                className="w-full rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:outline-none focus:ring-0"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="publish-branch" className="block text-xs font-medium text-foreground">
                <GitBranch size={12} className="mr-1 inline -mt-0.5" />
                Default branch
              </label>
              <input
                id="publish-branch"
                type="text"
                value={defaultBranch}
                onChange={(event) => setDefaultBranch(event.target.value)}
                placeholder="main"
                className="w-full rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:outline-none focus:ring-0"
              />
            </div>

            <div className="space-y-2">
              <span className="block text-xs font-medium text-foreground">Visibility</span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setIsPrivate(false)}
                  aria-pressed={!isPrivate}
                  className={[
                    'flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors',
                    !isPrivate
                      ? 'border-brand bg-brand/10 text-foreground ring-1 ring-brand/30'
                      : 'border-border bg-surface-muted text-muted-foreground hover:text-foreground',
                  ].join(' ')}
                >
                  <Globe size={14} className={!isPrivate ? 'text-brand' : 'text-muted-foreground'} />
                  <span>
                    <span className="block text-xs font-medium">Public</span>
                    <span className="block text-[10px] text-muted-foreground">Anyone can see</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsPrivate(true)}
                  aria-pressed={isPrivate}
                  className={[
                    'flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors',
                    isPrivate
                      ? 'border-brand bg-brand/10 text-foreground ring-1 ring-brand/30'
                      : 'border-border bg-surface-muted text-muted-foreground hover:text-foreground',
                  ].join(' ')}
                >
                  <Lock size={14} className={isPrivate ? 'text-brand' : 'text-muted-foreground'} />
                  <span>
                    <span className="block text-xs font-medium">Private</span>
                    <span className="block text-[10px] text-muted-foreground">Only you can see</span>
                  </span>
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5">
                <AlertCircle size={14} className="mt-0.5 shrink-0 text-red-500" />
                <p className="text-xs leading-relaxed text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handlePublish()}
                disabled={!isFormValid}
                className="flex items-center gap-2 rounded-lg bg-[#24292e] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a1f23] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Github size={14} />
                Publish to GitHub
              </button>
            </div>
          </div>
        ) : step === 'publishing' ? (
          <div className="flex flex-col items-center justify-center space-y-4 px-6 py-12">
            <div className="relative">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#24292e] text-white shadow-lg">
                <Github size={24} />
              </div>
              <div className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-surface">
                <Loader2 size={12} className="animate-spin text-brand" />
              </div>
            </div>
            <div className="space-y-1 text-center">
              <p className="text-sm font-medium text-foreground">Publishing to GitHub…</p>
              <p className="text-xs text-muted-foreground">Creating the repository and pushing your code</p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center space-y-5 px-6 py-10">
            <div className="relative">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#24292e] text-white shadow-lg">
                <Github size={24} />
              </div>
              <div className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 shadow">
                <CheckCircle2 size={14} className="text-white" />
              </div>
            </div>
            <div className="space-y-1 text-center">
              <p className="text-sm font-semibold text-foreground">Published successfully</p>
              <p className="text-xs text-muted-foreground">Your repository is now live on GitHub</p>
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
