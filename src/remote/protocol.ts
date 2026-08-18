export const REMOTE_PROTOCOL_VERSION = 1

export const REMOTE_RPC_NAMESPACES = [
  'tidecodeApp',
  'tidecodeChat',
  'tidecodeGit',
  'tidecodeHistory',
  'tidecodeKanban',
  'tidecodeModels',
  'tidecodeMcp',
  'tidecodeProviders',
  'tidecodeRuns',
  'tidecodeSkills',
  'tidecodeSettings',
  'tidecodeUpdates',
  'tidecodeWorkspace',
  'tidecodeTerminal',
] as const

export type RemoteRpcNamespace = (typeof REMOTE_RPC_NAMESPACES)[number]

export const REMOTE_EVENT_CHANNELS = {
  appLaunchRequest: 'app.launchRequest',
  chatStream: 'chat.stream',
  gitSourceControl: 'git.sourceControl',
  historyChanged: 'history.changed',
  historyProjectFolderPruned: 'history.projectFolderPruned',
  kanbanChanged: 'kanban.changed',
  mcpState: 'mcp.state',
  providersState: 'providers.state',
  settingsChanged: 'settings.changed',
  runsEvent: 'runs.event',
  terminalData: 'terminal.data',
  terminalExit: 'terminal.exit',
  terminalTabClosed: 'terminal.tabClosed',
  updatesState: 'updates.state',
  workspaceExplorer: 'workspace.explorer',
} as const

export type RemoteEventChannel = (typeof REMOTE_EVENT_CHANNELS)[keyof typeof REMOTE_EVENT_CHANNELS]

export interface RemoteRpcRequest {
  args: unknown[]
  id: string
  kind: 'rpc'
  method: string
  namespace: RemoteRpcNamespace
  protocolVersion: number
}

export interface RemoteRpcResponse {
  error?: string
  id: string
  kind: 'rpc-result'
  ok: boolean
  protocolVersion: number
  result?: unknown
}

export interface RemoteEventMessage {
  channel: RemoteEventChannel
  kind: 'event'
  payload: unknown
  protocolVersion: number
}

export interface RemoteReadyMessage {
  kind: 'ready'
  protocolVersion: number
}

export type RemoteServerMessage = RemoteRpcResponse | RemoteEventMessage | RemoteReadyMessage

export interface RemoteBridgeRequest {
  args: unknown[]
  id: string
  method: string
  namespace: RemoteRpcNamespace
}

export interface RemoteBridgeEvent {
  channel: RemoteEventChannel
  payload: unknown
}

export type RemoteHostLifecycleState = 'starting' | 'running' | 'restarting' | 'stopped' | 'error'

export interface RemoteHostAddress {
  address: string
  interfaceName: string
  kind: 'lan' | 'overlay' | 'virtual' | 'other'
  url: string
}

export interface RemoteHostConfiguration {
  port: number
  webAuthEnabled: boolean
  webUsername: string
}

export interface RemoteHostStatus {
  addresses: RemoteHostAddress[]
  boundPort: number | null
  configuredPort: number
  connectedClientCount: number
  enabled: boolean
  error: string | null
  lifecycleState: RemoteHostLifecycleState
  port: number | null
  portOverrideActive: boolean
  primaryUrl: string | null
  remoteUrl: string | null
  urls: string[]
  webAuthEnabled: boolean
  webCredentialsConfigured: boolean
}

export interface UpdateRemoteNetworkInput {
  port: number
}

export interface UpdateRemoteWebAuthInput {
  enabled: boolean
  password?: string
  username: string
}

export interface TideCodeRemoteHostBridgeApi {
  clearWebCredentials: () => Promise<RemoteHostStatus>
  emitEvent: (event: RemoteBridgeEvent) => void
  getConfiguration: () => Promise<RemoteHostConfiguration>
  getStatus: () => Promise<RemoteHostStatus>
  onStatus: (listener: (status: RemoteHostStatus) => void) => () => void
  updateNetwork: (input: UpdateRemoteNetworkInput) => Promise<RemoteHostStatus>
  updateWebAuth: (input: UpdateRemoteWebAuthInput) => Promise<RemoteHostStatus>
}

export function isRemoteRpcNamespace(value: unknown): value is RemoteRpcNamespace {
  return typeof value === 'string' && (REMOTE_RPC_NAMESPACES as readonly string[]).includes(value)
}

export function isRemoteRpcRequest(value: unknown): value is RemoteRpcRequest {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<RemoteRpcRequest>
  return candidate.kind === 'rpc'
    && candidate.protocolVersion === REMOTE_PROTOCOL_VERSION
    && typeof candidate.id === 'string'
    && candidate.id.length > 0
    && isRemoteRpcNamespace(candidate.namespace)
    && typeof candidate.method === 'string'
    && candidate.method.length > 0
    && Array.isArray(candidate.args)
}
