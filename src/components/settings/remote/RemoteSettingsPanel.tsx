import { Check, Copy, Eye, EyeOff, RefreshCw, ShieldCheck, Wifi } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { RemoteHostConfiguration, RemoteHostStatus } from '../../../remote/protocol'
import { useIsMobileViewport } from '../../../hooks/useIsMobileViewport'
import { SegmentedField } from '../../ui/SegmentedField'
import { SettingsPanelLayout, SettingsRow, SettingsSection } from '../shared/SettingsPanelPrimitives'

const AUTH_OPTIONS = [
  { label: 'Off', value: 'off' },
  { label: 'On', value: 'on' },
] as const

const INPUT_CLASS = 'h-10 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-none placeholder:text-subtle-foreground disabled:cursor-not-allowed disabled:opacity-60'
const BUTTON_CLASS = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-3.5 text-sm font-semibold text-foreground transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50'
const PRIMARY_BUTTON_CLASS = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-brand-border bg-brand-soft px-3.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50'

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'The Remote setting could not be updated.'
}

function kindLabel(kind: RemoteHostStatus['addresses'][number]['kind']) {
  if (kind === 'lan') return 'LAN'
  if (kind === 'overlay') return 'Overlay network'
  if (kind === 'virtual') return 'Virtual adapter'
  return 'Network adapter'
}

export function RemoteSettingsPanel() {
  const isMobileViewport = useIsMobileViewport()
  const bridge = window.tidecodeRemoteHost
  const [configuration, setConfiguration] = useState<RemoteHostConfiguration | null>(null)
  const [status, setStatus] = useState<RemoteHostStatus | null>(null)
  const [portValue, setPortValue] = useState('38472')
  const [authEnabled, setAuthEnabled] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)
  const [isConfirmPasswordVisible, setIsConfirmPasswordVisible] = useState(false)
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState<'network' | 'auth' | 'clear' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!bridge) return
    let disposed = false
    void Promise.all([bridge.getConfiguration(), bridge.getStatus()]).then(([nextConfiguration, nextStatus]) => {
      if (disposed) return
      const resolvedConfiguration = nextStatus.lifecycleState === 'running' && !nextStatus.portOverrideActive
        ? { ...nextConfiguration, port: nextStatus.configuredPort }
        : nextConfiguration
      setConfiguration(resolvedConfiguration)
      setStatus(nextStatus)
      setPortValue(String(resolvedConfiguration.port))
      setAuthEnabled(nextConfiguration.webAuthEnabled)
      setUsername(nextConfiguration.webUsername)
    }).catch((cause) => {
      if (!disposed) setError(errorMessage(cause))
    })
    const unsubscribe = bridge.onStatus((nextStatus) => setStatus(nextStatus))
    return () => { disposed = true; unsubscribe() }
  }, [bridge])

  const statusConfiguredPort = status?.configuredPort
  const statusLifecycleState = status?.lifecycleState
  const statusPortOverrideActive = status?.portOverrideActive
  useEffect(() => {
    if (statusConfiguredPort === undefined || statusLifecycleState !== 'running' || statusPortOverrideActive) return
    setConfiguration((current) => current ? { ...current, port: statusConfiguredPort } : current)
    setPortValue(String(statusConfiguredPort))
  }, [statusConfiguredPort, statusLifecycleState, statusPortOverrideActive])

  const statusLabel = useMemo(() => {
    if (!status) return 'Loading'
    if (status.lifecycleState === 'error') return 'Error'
    if (status.lifecycleState === 'restarting') return 'Restarting'
    if (status.enabled) return 'Running'
    return 'Stopped'
  }, [status])

  if (!bridge) {
    return (
      <SettingsPanelLayout>
        <SettingsSection title="Remote">
          <div className="px-4 py-4 text-sm text-muted-foreground md:px-5">Remote host management is available only in the TideCode desktop app.</div>
        </SettingsSection>
      </SettingsPanelLayout>
    )
  }

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setCopiedUrl(url)
      setError(null)
      window.setTimeout(() => setCopiedUrl((current) => current === url ? null : current), 1400)
    } catch {
      setError('Unable to copy the Remote URL.')
    }
  }

  const savePort = async () => {
    const port = Number(portValue)
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      setError('Port must be a whole number between 1024 and 65535.')
      return
    }
    setBusy('network')
    setError(null)
    setNotice(null)
    try {
      const nextStatus = await bridge.updateNetwork({ port })
      const nextConfiguration = await bridge.getConfiguration()
      setStatus(nextStatus)
      setConfiguration(nextConfiguration)
      setPortValue(String(nextConfiguration.port))
      setNotice('Remote port updated.')
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(null)
    }
  }

  const saveAuth = async () => {
    if (authEnabled && username.trim().length === 0) {
      setError('Enter a username before enabling web login.')
      return
    }
    if (password && password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('The password confirmation does not match.')
      return
    }
    if (authEnabled && !status?.webCredentialsConfigured && password.length === 0) {
      setError('Set a password before enabling web login.')
      return
    }
    setBusy('auth')
    setError(null)
    setNotice(null)
    try {
      const nextStatus = await bridge.updateWebAuth({
        enabled: authEnabled,
        username: username.trim(),
        ...(password ? { password } : {}),
      })
      const nextConfiguration = await bridge.getConfiguration()
      setStatus(nextStatus)
      setConfiguration(nextConfiguration)
      setAuthEnabled(nextConfiguration.webAuthEnabled)
      setUsername(nextConfiguration.webUsername)
      setPassword('')
      setConfirmPassword('')
      setNotice('Web authentication updated. Existing browser sessions were signed out if the security settings changed.')
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(null)
    }
  }

  const clearCredentials = async () => {
    setBusy('clear')
    setError(null)
    setNotice(null)
    try {
      const nextStatus = await bridge.clearWebCredentials()
      const nextConfiguration = await bridge.getConfiguration()
      setStatus(nextStatus)
      setConfiguration(nextConfiguration)
      setAuthEnabled(false)
      setUsername('')
      setPassword('')
      setConfirmPassword('')
      setNotice('Remote web credentials cleared. Web login is disabled.')
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(null)
    }
  }

  return (
    <SettingsPanelLayout>
      <SettingsSection title="Remote access">
        <div className="px-4 py-4 md:px-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <Wifi size={19} className="mt-0.5 shrink-0 text-brand" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-foreground">{statusLabel}</p>
                <p className="mt-1 text-sm leading-5 text-muted-foreground">TideCode must be open on this computer for browser access to work.</p>
                <p className="mt-2 text-xs text-subtle-foreground">{status?.connectedClientCount ?? 0} browser{status?.connectedClientCount === 1 ? '' : 's'} connected</p>
              </div>
            </div>
            {status?.lifecycleState === 'restarting' ? <RefreshCw size={18} className="animate-spin text-brand" /> : null}
          </div>
          {status?.error ? <div className="mt-4 rounded-xl border border-danger-border bg-danger-surface px-3 py-2.5 text-sm text-danger-foreground">{status.error}</div> : null}
          {error ? <div role="alert" className="mt-4 rounded-xl border border-danger-border bg-danger-surface px-3 py-2.5 text-sm text-danger-foreground">{error}</div> : null}
          {notice ? <div className="mt-4 rounded-xl border border-brand-border bg-brand-soft px-3 py-2.5 text-sm text-brand-soft-foreground">{notice}</div> : null}
        </div>
      </SettingsSection>

      <SettingsSection title="Access addresses">
        <div className="divide-y divide-border">
          {(status?.addresses ?? []).map((entry) => (
            <div key={entry.interfaceName + entry.address} className="flex items-center justify-between gap-3 px-4 py-3.5 md:px-5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="break-all text-sm font-medium text-foreground">{entry.url}</p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{entry.interfaceName} · {kindLabel(entry.kind)}</p>
              </div>
              <button
                type="button"
                aria-label={copiedUrl === entry.url ? 'Remote URL copied' : `Copy ${entry.url}`}
                title={isMobileViewport ? undefined : copiedUrl === entry.url ? 'Copied' : 'Copy URL'}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center bg-transparent p-0 text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => void copyUrl(entry.url)}
              >
                {copiedUrl === entry.url ? <Check size={16} className="text-brand" /> : <Copy size={16} />}
              </button>
            </div>
          ))}
          {(status?.addresses.length ?? 0) === 0 ? <div className="px-4 py-4 text-sm text-muted-foreground md:px-5">No network address is currently available.</div> : null}
        </div>
      </SettingsSection>

      <SettingsSection title="Network">
        <SettingsRow title="Remote port" description="The TCP port used by the browser UI and Remote WebSocket server. Changing it restarts Remote access.">
          <div className="flex w-full gap-2 md:w-[300px]">
            <input aria-label="Remote port" inputMode="numeric" className={INPUT_CLASS} value={portValue} placeholder="38472" disabled={busy !== null || status?.portOverrideActive} onChange={(event) => setPortValue(event.target.value)} />
            <button type="button" className={PRIMARY_BUTTON_CLASS} disabled={busy !== null || status?.portOverrideActive || portValue === String(configuration?.port ?? '')} onClick={() => void savePort()}>Apply</button>
          </div>
        </SettingsRow>
        {status?.portOverrideActive ? <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground md:px-5">This process is using the TIDECODE_REMOTE_PORT environment override, so the port cannot be changed from Settings until that override is removed.</div> : null}
      </SettingsSection>

      <SettingsSection title="Web authentication">
        <SettingsRow title="Require login for web access" description="Require a TideCode Remote username and password before the browser UI or Remote WebSocket can be used.">
          <SegmentedField ariaLabel="Require Remote web login" value={authEnabled ? 'on' : 'off'} options={AUTH_OPTIONS} disabled={busy !== null} onChange={(value) => setAuthEnabled(value === 'on')} />
        </SettingsRow>
        <div className="border-t border-border px-4 py-4 md:px-5">
          <div className="flex items-start gap-3">
            <ShieldCheck size={18} className="mt-0.5 shrink-0 text-brand" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{status?.webCredentialsConfigured ? 'Password configured' : 'No password configured'}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">The password is stored as a one-way verifier and cannot be read back from TideCode.</p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="text-xs font-medium text-muted-foreground md:col-span-2">Username<input className={INPUT_CLASS + ' mt-1.5'} value={username} disabled={busy !== null} autoComplete="off" placeholder="e.g. admin" onChange={(event) => setUsername(event.target.value)} /></label>
            <label className="text-xs font-medium text-muted-foreground">
              New password
              <div className="relative mt-1.5">
                <input type={isPasswordVisible ? 'text' : 'password'} className={INPUT_CLASS + ' pr-10'} value={password} disabled={busy !== null} autoComplete="new-password" placeholder={status?.webCredentialsConfigured ? 'Leave blank to keep current' : 'At least 8 characters'} onChange={(event) => setPassword(event.target.value)} />
                <button type="button" aria-label={isPasswordVisible ? 'Hide Remote password' : 'Show Remote password'} onClick={() => setIsPasswordVisible((current) => !current)} className="absolute right-0 top-0 flex h-10 w-10 items-center justify-center text-muted-foreground hover:text-foreground">
                  {isPasswordVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>
            <label className="text-xs font-medium text-muted-foreground">
              Confirm password
              <div className="relative mt-1.5">
                <input type={isConfirmPasswordVisible ? 'text' : 'password'} className={INPUT_CLASS + ' pr-10'} value={confirmPassword} disabled={busy !== null} autoComplete="new-password" placeholder="Re-enter password" onChange={(event) => setConfirmPassword(event.target.value)} />
                <button type="button" aria-label={isConfirmPasswordVisible ? 'Hide Remote password confirmation' : 'Show Remote password confirmation'} onClick={() => setIsConfirmPasswordVisible((current) => !current)} className="absolute right-0 top-0 flex h-10 w-10 items-center justify-center text-muted-foreground hover:text-foreground">
                  {isConfirmPasswordVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className={PRIMARY_BUTTON_CLASS} disabled={busy !== null} onClick={() => void saveAuth()}>{busy === 'auth' ? 'Saving...' : 'Save authentication'}</button>
            <button type="button" className={BUTTON_CLASS} disabled={busy !== null || !status?.webCredentialsConfigured} onClick={() => void clearCredentials()}>{busy === 'clear' ? 'Clearing...' : 'Clear credentials'}</button>
          </div>
        </div>
      </SettingsSection>
    </SettingsPanelLayout>
  )
}
