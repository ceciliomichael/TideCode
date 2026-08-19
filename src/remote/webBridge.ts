import type { AppSettings } from '../types/chat'
import {
  REMOTE_EVENT_CHANNELS,
  REMOTE_PROTOCOL_VERSION,
  type RemoteEventChannel,
  type RemoteRpcNamespace,
  type RemoteServerMessage,
} from './protocol'

const RPC_TIMEOUT_MS = 120_000

type Listener = (payload: unknown) => void

function createRequestId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
}

class RemoteConnection {
  private socket: WebSocket | null = null
  private connectPromise: Promise<void> | null = null
  private reconnectTimer: number | null = null
  private readonly pending = new Map<string, {
    reject: (error: Error) => void
    resolve: (value: unknown) => void
    timeoutId: number
  }>()
  private readonly listeners = new Map<RemoteEventChannel, Set<Listener>>()

  private getSocketUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return new URL('/remote/ws', `${protocol}//${window.location.host}`).toString()
  }

  async connect() {
    if (this.socket?.readyState === WebSocket.OPEN) return
    if (this.connectPromise) return this.connectPromise

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.getSocketUrl())
      this.socket = socket
      let settled = false

      socket.addEventListener('open', () => undefined)
      socket.addEventListener('message', (event) => {
        if (typeof event.data === 'string') {
          try {
            const message = JSON.parse(event.data) as RemoteServerMessage
            if (message.kind === 'ready') {
              if (message.protocolVersion !== REMOTE_PROTOCOL_VERSION) {
                if (!settled) {
                  settled = true
                  this.connectPromise = null
                  reject(new Error('This TideCode remote client is not compatible with the desktop host.'))
                }
                socket.close(1002, 'Protocol version mismatch')
                return
              }
              if (!settled) {
                settled = true
                this.connectPromise = null
                resolve()
              }
              return
            }
          } catch {
            // Let the normal message handler ignore malformed payloads.
          }
        }
        this.handleMessage(event.data)
      })
      socket.addEventListener('error', () => {
        if (!settled) {
          settled = true
          this.connectPromise = null
          reject(new Error('Unable to connect to the TideCode desktop host.'))
        }
      })
      socket.addEventListener('close', (event) => {
        if (event.code === 4001) {
          window.location.reload()
          return
        }
        if (!settled) {
          settled = true
          reject(new Error('The TideCode remote connection closed before protocol initialization.'))
        }
        this.socket = null
        this.connectPromise = null
        for (const pending of this.pending.values()) {
          window.clearTimeout(pending.timeoutId)
          pending.reject(new Error('The TideCode remote connection closed.'))
        }
        this.pending.clear()
        this.scheduleReconnect()
      })
    })

    return this.connectPromise
  }

  private scheduleReconnect() {
    if (this.reconnectTimer !== null) return
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      void this.connect().catch(() => this.scheduleReconnect())
    }, 1_000)
  }

  private handleMessage(raw: unknown) {
    if (typeof raw !== 'string') return
    let message: RemoteServerMessage
    try {
      message = JSON.parse(raw) as RemoteServerMessage
    } catch {
      return
    }
    if (message.protocolVersion !== REMOTE_PROTOCOL_VERSION) return

    if (message.kind === 'rpc-result') {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      window.clearTimeout(pending.timeoutId)
      if (message.ok) pending.resolve(message.result)
      else pending.reject(new Error(message.error || 'Remote operation failed.'))
      return
    }

    if (message.kind === 'event') {
      for (const listener of this.listeners.get(message.channel) ?? []) {
        listener(message.payload)
      }
    }
  }

  async rpc(namespace: RemoteRpcNamespace, method: string, args: unknown[]) {
    await this.connect()
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error('The TideCode remote connection is not available.')
    }

    const id = createRequestId()
    return new Promise<unknown>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Remote operation timed out: ${namespace}.${method}`))
      }, RPC_TIMEOUT_MS)
      this.pending.set(id, { reject, resolve, timeoutId })
      socket.send(JSON.stringify({
        args,
        id,
        kind: 'rpc',
        method,
        namespace,
        protocolVersion: REMOTE_PROTOCOL_VERSION,
      }))
    })
  }

  subscribe(channel: RemoteEventChannel, listener: Listener) {
    const current = this.listeners.get(channel) ?? new Set<Listener>()
    current.add(listener)
    this.listeners.set(channel, current)
    return () => {
      current.delete(listener)
      if (current.size === 0) this.listeners.delete(channel)
    }
  }
}

function createRemoteApi(
  connection: RemoteConnection,
  namespace: RemoteRpcNamespace,
  events: Record<string, { channel: RemoteEventChannel; noPayload?: boolean }> = {},
  overrides: Record<string, unknown> = {},
) {
  return new Proxy({}, {
    get(_target, property) {
      const method = String(property)
      if (method in overrides) return overrides[method]
      const event = events[method]
      if (event) {
        return (listener: (...args: unknown[]) => void) => connection.subscribe(event.channel, (payload) => {
          if (event.noPayload) listener()
          else listener(payload)
        })
      }
      return (...args: unknown[]) => connection.rpc(namespace, method, args)
    },
  })
}

const IS_REMOTE_BROWSER_RUNTIME = typeof window !== 'undefined' && typeof window.tidecodeApp === 'undefined'

function hasRemoteBrowserRuntimeMarker() {
  return typeof document !== 'undefined'
    && document.documentElement.dataset.tidecodeRuntime === 'remote-browser'
}

export function isRemoteBrowserRuntime() {
  return IS_REMOTE_BROWSER_RUNTIME || hasRemoteBrowserRuntimeMarker()
}

export async function installRemoteBrowserBridge() {
  if (!isRemoteBrowserRuntime()) return
  document.documentElement.dataset.tidecodeRuntime = 'remote-browser'
  const connection = new RemoteConnection()
  await connection.connect()
  const [initialSettings, draftAgentContextPath] = await Promise.all([
    connection.rpc('tidecodeSettings', 'getSettings', []) as Promise<AppSettings>,
    connection.rpc('tidecodeHistory', 'getDraftAgentContextPathSync', []) as Promise<string>,
  ])

  const globals = window as unknown as Record<string, unknown>
  globals.tidecodeApp = createRemoteApi(connection, 'tidecodeApp', {
    onLaunchRequest: { channel: REMOTE_EVENT_CHANNELS.appLaunchRequest },
  }, {
    getInitialLaunchRequest: () => null,
  })
  globals.tidecodeChat = createRemoteApi(connection, 'tidecodeChat', {
    onStreamEvent: { channel: REMOTE_EVENT_CHANNELS.chatStream },
  })
  globals.tidecodeGit = createRemoteApi(connection, 'tidecodeGit', {
    onSourceControlChange: { channel: REMOTE_EVENT_CHANNELS.gitSourceControl },
  })
  globals.tidecodeHistory = createRemoteApi(connection, 'tidecodeHistory', {
    onProjectFolderPruned: { channel: REMOTE_EVENT_CHANNELS.historyProjectFolderPruned },
    onRemoteChange: { channel: REMOTE_EVENT_CHANNELS.historyChanged },
  }, {
    getDraftAgentContextPathSync: () => draftAgentContextPath,
  })
  globals.tidecodeKanban = createRemoteApi(connection, 'tidecodeKanban', {
    onBoardChange: { channel: REMOTE_EVENT_CHANNELS.kanbanChanged },
  })
  globals.tidecodeModels = createRemoteApi(connection, 'tidecodeModels')
  globals.tidecodeMcp = createRemoteApi(connection, 'tidecodeMcp', {
    onStateChange: { channel: REMOTE_EVENT_CHANNELS.mcpState },
  })
  globals.tidecodeProviders = createRemoteApi(connection, 'tidecodeProviders', {
    onStateChange: { channel: REMOTE_EVENT_CHANNELS.providersState, noPayload: true },
  })
  globals.tidecodeRuns = createRemoteApi(connection, 'tidecodeRuns', {
    onEvent: { channel: REMOTE_EVENT_CHANNELS.runsEvent },
  })
  globals.tidecodeSkills = createRemoteApi(connection, 'tidecodeSkills')
  globals.tidecodeSettings = createRemoteApi(connection, 'tidecodeSettings', {
    onRemoteChange: { channel: REMOTE_EVENT_CHANNELS.settingsChanged },
  }, {
    getInitialSettings: () => initialSettings,
  })
  globals.tidecodeUpdates = createRemoteApi(connection, 'tidecodeUpdates', {
    onUpdateState: { channel: REMOTE_EVENT_CHANNELS.updatesState },
  })
  globals.tidecodeWorkspace = createRemoteApi(connection, 'tidecodeWorkspace', {
    onExplorerChange: { channel: REMOTE_EVENT_CHANNELS.workspaceExplorer },
  })
  globals.tidecodeTerminal = createRemoteApi(connection, 'tidecodeTerminal', {
    onData: { channel: REMOTE_EVENT_CHANNELS.terminalData },
    onExit: { channel: REMOTE_EVENT_CHANNELS.terminalExit },
    onTabClosed: { channel: REMOTE_EVENT_CHANNELS.terminalTabClosed },
  })

  globals.tidecodeFileDrop = { getPathForFile: () => '' }
  globals.tidecodeClipboard = { readFiles: async () => [] }
}
