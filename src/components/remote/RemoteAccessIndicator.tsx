import { useEffect, useState } from 'react'
import type { RemoteHostStatus, TideCodeRemoteHostBridgeApi } from '../../remote/protocol'

function getRemoteHostBridge(): TideCodeRemoteHostBridgeApi | undefined {
  return (window as Window & { tidecodeRemoteHost?: TideCodeRemoteHostBridgeApi }).tidecodeRemoteHost
}

export function RemoteAccessIndicator() {
  const [status, setStatus] = useState<RemoteHostStatus | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const bridge = getRemoteHostBridge()
    if (!bridge) return
    let disposed = false
    void bridge.getStatus().then((nextStatus) => {
      if (!disposed) setStatus(nextStatus)
    })
    const unsubscribe = bridge.onStatus((nextStatus) => setStatus(nextStatus))
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])

  const bridge = getRemoteHostBridge()
  if (!bridge) return null

  const displayUrl = status?.urls[0] ?? null
  const label = status?.error
    ? 'Remote unavailable'
    : status?.enabled && displayUrl
      ? displayUrl.replace(/^https?:\/\//, '')
      : 'Remote starting'

  const copyRemoteUrl = async () => {
    if (!status?.remoteUrl) return
    try {
      await navigator.clipboard.writeText(status.remoteUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch (error) {
      console.error('Unable to copy TideCode LAN remote URL.', error)
      window.prompt('Copy TideCode LAN remote URL', status.remoteUrl)
    }
  }

  const dotClass = status?.enabled ? 'bg-emerald-500' : status?.error ? 'bg-red-500' : 'bg-amber-500'

  return (
    <button
      type="button"
      onClick={copyRemoteUrl}
      disabled={!status?.remoteUrl}
      title={status?.remoteUrl ? 'Copy TideCode LAN remote URL. No login is required on the current LAN-only build.' : status?.error ?? 'Remote host is starting'}
      className="fixed bottom-3 right-3 z-40 flex max-w-[min(520px,calc(100vw-24px))] items-center gap-2 rounded-lg border border-border/80 bg-background/95 px-3 py-2 text-xs text-muted-foreground shadow-lg backdrop-blur transition hover:text-foreground disabled:cursor-default disabled:opacity-70"
    >
      <span className={'h-2 w-2 shrink-0 rounded-full ' + dotClass} />
      <span className="truncate">{copied ? 'Remote URL copied' : 'Remote ' + label}</span>
      {status?.connectedClientCount ? (
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-foreground">
          {status.connectedClientCount} connected
        </span>
      ) : null}
    </button>
  )
}
