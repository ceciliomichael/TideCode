import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  GitBranch,
  Globe,
  Github,
  Link2,
  Loader2,
  Lock,
  Server,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  GitHubAuthStatus,
  GitHubDeviceLoginResult,
  GitPublishInput,
  GitPublishRemoteInput,
} from '../../types/chat'

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

function isValidRemoteUrl(url: string) {
  const trimmed = url.trim()
  if (!trimmed) return false
  return (
    trimmed.startsWith('https://') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('git@') ||
    trimmed.startsWith('ssh://') ||
    trimmed.startsWith('file://')
  )
}

function detectRemoteProvider(url: string): { name: string; dotColor: string } {
  const lower = url.toLowerCase()
  if (lower.includes('gitlab')) return { name: 'GitLab', dotColor: 'bg-[#fc6d26]' }
  if (lower.includes('bitbucket')) return { name: 'Bitbucket', dotColor: 'bg-[#2684ff]' }
  if (lower.includes('github')) return { name: 'GitHub', dotColor: 'bg-foreground' }
  if (lower.includes('gitea') || lower.includes('codeberg')) return { name: 'Gitea', dotColor: 'bg-[#609926]' }
  return { name: 'Git Remote', dotColor: 'bg-emerald-500' }
}

type PublishTab = 'remote' | 'github'
type PublishStep = 'form' | 'publishing' | 'success' | 'error'

export function PublishToGitHubModal({ workspacePath, onClose, onPublishSuccess }: PublishToGitHubModalProps) {
  const [activeTab, setActiveTab] = useState<PublishTab>('remote')
  const [step, setStep] = useState<PublishStep>('form')
  const [remoteUrl, setRemoteUrl] = useState('')
  const [remoteName, setRemoteName] = useState('origin')
  const [repoName, setRepoName] = useState(getDefaultRepoName(workspacePath))
  const [description, setDescription] = useState('')
  const [defaultBranch, setDefaultBranch] = useState('main')
  const [isPrivate, setIsPrivate] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [authStatus, setAuthStatus] = useState<GitHubAuthStatus | null>(null)
  const [isCheckingAuth, setIsCheckingAuth] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [deviceLogin, setDeviceLogin] = useState<GitHubDeviceLoginResult | null>(null)
  const remoteUrlInputRef = useRef<HTMLInputElement>(null)
  const repoNameInputRef = useRef<HTMLInputElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  const detectedProvider = detectRemoteProvider(remoteUrl)

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
    remoteUrlInputRef.current?.focus()
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

  async function handlePublishToRemote() {
    const trimmedUrl = remoteUrl.trim()
    if (!trimmedUrl) {
      setError('Remote repository URL is required.')
      return
    }
    if (!isValidRemoteUrl(trimmedUrl)) {
      setError('Please enter a valid Git remote URL (e.g. https://gitlab.com/... or git@gitlab.com:...).')
      return
    }

    setStep('publishing')
    setError(null)

    const input: GitPublishRemoteInput = {
      workspacePath,
      remoteUrl: trimmedUrl,
      remoteName: remoteName.trim() || 'origin',
      defaultBranch: defaultBranch.trim() || 'main',
    }

    try {
      const result = await window.tidecodeGit.publishToRemote(input)
      setResultUrl(result.repoUrl || result.remoteUrl)
      setStep('success')
      onPublishSuccess()
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : 'Failed to publish to remote.')
      setStep('error')
    }
  }

  async function handlePublishToGitHub() {
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
      setResultUrl(result.repoUrl)
      setStep('success')
      onPublishSuccess()
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : 'Failed to publish to GitHub.')
      setStep('error')
      await refreshAuthStatus()
    }
  }

  function handleOpenRepo() {
    if (resultUrl) {
      window.open(resultUrl, '_blank', 'noopener,noreferrer')
    }
  }

  const isRemoteFormValid = isValidRemoteUrl(remoteUrl.trim())
  const isGitHubFormValid =
    repoName.trim().length > 0 &&
    isValidRepositoryName(repoName.trim()) &&
    authStatus?.kind === 'authenticated' &&
    !isCheckingAuth &&
    !isConnecting

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-3 backdrop-blur-[2px]"
      style={{ animation: 'fadeIn 0.15s ease-out' }}
    >
      <div
        className="relative max-h-[calc(100vh-24px)] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-surface shadow-2xl"
        style={{ animation: 'slideUp 0.2s ease-out' }}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-muted text-foreground shadow-xs">
              <Globe size={17} className="text-muted-foreground" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground leading-tight">Publish Repository</h2>
              <p className="text-xs text-muted-foreground mt-0.5 leading-normal">Connect to GitLab, Bitbucket, GitHub, or any remote</p>
            </div>
          </div>
          {step !== 'publishing' && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close publish dialog"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Tab switcher: Segmented pill control with pixel-perfect vertical alignment */}
        {(step === 'form' || step === 'error') && (
          <div className="px-6 pt-4 pb-1">
            <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-surface-muted/90 p-1 border border-border">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('remote')
                  setError(null)
                }}
                className={[
                  'group flex h-8.5 items-center justify-center gap-2 rounded-lg text-xs font-medium transition-all duration-150 select-none',
                  activeTab === 'remote'
                    ? 'bg-surface text-foreground font-semibold shadow-xs border border-border'
                    : 'text-muted-foreground hover:text-foreground hover:bg-surface/50 border border-transparent',
                ].join(' ')}
              >
                <Link2
                  size={13}
                  className={[
                    'shrink-0 transition-colors',
                    activeTab === 'remote' ? 'text-brand' : 'text-muted-foreground group-hover:text-foreground',
                  ].join(' ')}
                />
                <span className="inline-flex items-center leading-none">
                  <span>Remote URL</span>
                  <span className="ml-1 text-[11px] font-normal opacity-60">(GitLab / Any)</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('github')
                  setError(null)
                }}
                className={[
                  'group flex h-8.5 items-center justify-center gap-2 rounded-lg text-xs font-medium transition-all duration-150 select-none',
                  activeTab === 'github'
                    ? 'bg-surface text-foreground font-semibold shadow-xs border border-border'
                    : 'text-muted-foreground hover:text-foreground hover:bg-surface/50 border border-transparent',
                ].join(' ')}
              >
                <Github
                  size={13}
                  className={[
                    'shrink-0 transition-colors',
                    activeTab === 'github' ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground',
                  ].join(' ')}
                />
                <span className="inline-flex items-center leading-none">
                  <span>GitHub</span>
                  <span className="ml-1 text-[11px] font-normal opacity-60">(1-Click)</span>
                </span>
              </button>
            </div>
          </div>
        )}

        {/* Body content */}
        {step === 'form' || step === 'error' ? (
          activeTab === 'remote' ? (
            /* TAB 1: Generic Remote URL (GitLab, Bitbucket, Gitea, Custom) */
            <div className="space-y-4 px-6 py-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="publish-remote-url" className="block text-xs font-medium text-foreground">
                    Remote Repository URL <span className="text-red-500">*</span>
                  </label>
                  {remoteUrl.trim().length > 0 && (
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-surface-muted px-2 py-0.5 text-[10px] font-medium text-foreground border border-border">
                      <span className={['h-1.5 w-1.5 rounded-full', detectedProvider.dotColor].join(' ')} />
                      {detectedProvider.name}
                    </span>
                  )}
                </div>
                <input
                  id="publish-remote-url"
                  ref={remoteUrlInputRef}
                  type="text"
                  value={remoteUrl}
                  onChange={(event) => {
                    setRemoteUrl(event.target.value)
                    if (step === 'error') setStep('form')
                    setError(null)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && isRemoteFormValid) void handlePublishToRemote()
                  }}
                  placeholder="https://gitlab.com/username/my-project.git"
                  className="w-full rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-brand/60 focus:ring-1 focus:ring-brand/20 transition-all"
                />
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Enter HTTPS or SSH clone URL from GitLab, Bitbucket, Gitea, or self-hosted Git.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label htmlFor="publish-remote-name" className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <Server size={12} className="shrink-0 text-muted-foreground" />
                    Remote name
                  </label>
                  <input
                    id="publish-remote-name"
                    type="text"
                    value={remoteName}
                    onChange={(event) => setRemoteName(event.target.value)}
                    placeholder="origin"
                    className="w-full rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-brand/60 focus:ring-1 focus:ring-brand/20 transition-all"
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="publish-remote-branch" className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <GitBranch size={12} className="shrink-0 text-muted-foreground" />
                    Branch
                  </label>
                  <input
                    id="publish-remote-branch"
                    type="text"
                    value={defaultBranch}
                    onChange={(event) => setDefaultBranch(event.target.value)}
                    placeholder="main"
                    className="w-full rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-brand/60 focus:ring-1 focus:ring-brand/20 transition-all"
                  />
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5">
                  <AlertCircle size={14} className="mt-0.5 shrink-0 text-red-500" />
                  <p className="text-xs leading-relaxed text-red-600 dark:text-red-400">{error}</p>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-border px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handlePublishToRemote()}
                  disabled={!isRemoteFormValid}
                  className="inline-flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 shadow-xs"
                >
                  <Link2 size={13} className="shrink-0" />
                  Connect & Push
                </button>
              </div>
            </div>
          ) : authStatus?.kind !== 'authenticated' ? (
            /* TAB 2: GitHub Sign In Gate */
            <div className="flex flex-col items-center gap-4 px-6 py-8 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-surface-muted shadow-xs">
                <Github size={22} className="text-foreground" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-foreground">Connect to GitHub</h3>
                <p className="text-xs leading-relaxed text-muted-foreground max-w-[280px]">
                  Sign in with GitHub to automatically create the repository and push your branch in one click.
                </p>
              </div>

              {isCheckingAuth && !authStatus ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 size={13} className="animate-spin text-brand" />
                  Checking your GitHub connection…
                </div>
              ) : isConnecting ? (
                <div className="w-full space-y-3 rounded-xl border border-border bg-surface-muted/60 p-3.5">
                  <div className="flex items-center justify-center gap-2 text-xs font-medium text-foreground">
                    <Loader2 size={13} className="animate-spin text-brand" />
                    Waiting for GitHub authorization…
                  </div>
                  {deviceLogin ? (
                    <>
                      <p className="text-xs text-muted-foreground">A browser window was opened. If prompted, enter this code:</p>
                      <p className="font-mono text-lg font-bold tracking-[0.2em] text-foreground">{deviceLogin.userCode}</p>
                      <a
                        href={deviceLogin.verificationUri}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-brand underline underline-offset-2 hover:opacity-80"
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
                    className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#24292e] px-4 text-xs font-medium text-white transition-colors hover:bg-[#1a1f23] shadow-xs"
                  >
                    <Github size={14} className="shrink-0" />
                    Connect to GitHub
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* TAB 2: GitHub Repository Creation Form */
            <div className="space-y-4 px-6 py-4">
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
                    if (event.key === 'Enter' && isGitHubFormValid) void handlePublishToGitHub()
                  }}
                  placeholder="my-awesome-project"
                  className="w-full rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-brand/60 focus:ring-1 focus:ring-brand/20 transition-all"
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
                  className="w-full rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-brand/60 focus:ring-1 focus:ring-brand/20 transition-all"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="publish-branch" className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
                  <GitBranch size={12} className="shrink-0 text-muted-foreground" />
                  Default branch
                </label>
                <input
                  id="publish-branch"
                  type="text"
                  value={defaultBranch}
                  onChange={(event) => setDefaultBranch(event.target.value)}
                  placeholder="main"
                  className="w-full rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-brand/60 focus:ring-1 focus:ring-brand/20 transition-all"
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
                      'flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm transition-all',
                      !isPrivate
                        ? 'border-brand bg-brand/10 text-foreground ring-1 ring-brand/30'
                        : 'border-border bg-surface-muted text-muted-foreground hover:text-foreground hover:bg-surface',
                    ].join(' ')}
                  >
                    <Globe size={14} className={['shrink-0', !isPrivate ? 'text-brand' : 'text-muted-foreground'].join(' ')} />
                    <span className="leading-tight">
                      <span className="block text-xs font-medium">Public</span>
                      <span className="block text-[10px] text-muted-foreground mt-0.5">Anyone can see</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsPrivate(true)}
                    aria-pressed={isPrivate}
                    className={[
                      'flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm transition-all',
                      isPrivate
                        ? 'border-brand bg-brand/10 text-foreground ring-1 ring-brand/30'
                        : 'border-border bg-surface-muted text-muted-foreground hover:text-foreground hover:bg-surface',
                    ].join(' ')}
                  >
                    <Lock size={14} className={['shrink-0', isPrivate ? 'text-brand' : 'text-muted-foreground'].join(' ')} />
                    <span className="leading-tight">
                      <span className="block text-xs font-medium">Private</span>
                      <span className="block text-[10px] text-muted-foreground mt-0.5">Only you can see</span>
                    </span>
                  </button>
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5">
                  <AlertCircle size={14} className="mt-0.5 shrink-0 text-red-500" />
                  <p className="text-xs leading-relaxed text-red-600 dark:text-red-400">{error}</p>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-border px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handlePublishToGitHub()}
                  disabled={!isGitHubFormValid}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#24292e] px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-[#1a1f23] disabled:cursor-not-allowed disabled:opacity-50 shadow-xs"
                >
                  <Github size={13} className="shrink-0" />
                  Publish to GitHub
                </button>
              </div>
            </div>
          )
        ) : step === 'publishing' ? (
          <div className="flex flex-col items-center justify-center space-y-4 px-6 py-12">
            <div className="relative">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-muted border border-border text-foreground shadow-lg">
                <Globe size={24} className="text-foreground" />
              </div>
              <div className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-surface shadow-xs">
                <Loader2 size={12} className="animate-spin text-brand" />
              </div>
            </div>
            <div className="space-y-1 text-center">
              <p className="text-sm font-semibold text-foreground leading-tight">Publishing repository…</p>
              <p className="text-xs text-muted-foreground">Configuring remote and pushing your branch</p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center space-y-5 px-6 py-10">
            <div className="relative">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-muted border border-border text-foreground shadow-lg">
                <Globe size={24} className="text-foreground" />
              </div>
              <div className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 shadow-xs">
                <CheckCircle2 size={14} className="text-white" />
              </div>
            </div>
            <div className="space-y-1 text-center">
              <p className="text-sm font-semibold text-foreground leading-tight">Published successfully</p>
              <p className="text-xs text-muted-foreground">Your repository is now connected to the remote</p>
            </div>
            {resultUrl && (resultUrl.startsWith('http://') || resultUrl.startsWith('https://')) && (
              <button
                type="button"
                onClick={handleOpenRepo}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface-muted px-4 py-2.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-muted/80 shadow-xs"
              >
                <ExternalLink size={13} className="shrink-0" />
                Open in Browser
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
          from { opacity: 0; transform: translateY(10px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  )
}

export const PublishRepositoryModal = PublishToGitHubModal
