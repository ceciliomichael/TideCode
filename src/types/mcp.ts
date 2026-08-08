export type McpTransportType = 'stdio' | 'streamable-http'
export type McpConfigSource = 'global'
export type McpConfigOwner = 'tidecode' | 'codex' | 'agents' | 'claude'
export type McpServerConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'error'
export type McpAddServerTransportType = 'stdio' | 'streamable-http'

export interface McpAddServerInput {
  args?: string[]
  command?: string
  env?: Record<string, string>
  headers?: Record<string, string>
  saveScope?: McpConfigSource
  serverName: string
  type: McpAddServerTransportType
  url?: string
}

export interface McpToolConfiguration {
  enabled: boolean
  allowedTools?: string[]
  disabledTools?: string[]
}

export interface McpTool {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  title?: string
}

export interface McpServerConfig {
  autoConnect: boolean
  owner: McpConfigOwner
  command?: string
  description?: string
  enabled: boolean
  env?: Record<string, string>
  headers?: Record<string, string>
  id: string
  isReadOnly: boolean
  name: string
  source: McpConfigSource
  toolNamespace: string
  toolConfiguration?: McpToolConfiguration
  type: McpTransportType
  url?: string
  args?: string[]
}

export interface McpServerStatus {
  connectedAt?: number
  error?: string
  serverId: string
  status: McpServerConnectionStatus
  toolCount?: number
  tools?: McpTool[]
}

export interface McpState {
  configs: McpServerConfig[]
  errorMessage: string | null
  statuses: Record<string, McpServerStatus>
}

export interface TideCodeMcpApi {
  addServer: (input: McpAddServerInput, workspacePath?: string | null) => Promise<McpState>
  connectServer: (serverId: string, workspacePath?: string | null) => Promise<McpState>
  disconnectServer: (serverId: string, workspacePath?: string | null) => Promise<McpState>
  getState: (workspacePath?: string | null) => Promise<McpState>
  onStateChange: (listener: (payload: { state: McpState; workspacePath: string | null }) => void) => () => void
  removeServer: (serverId: string, workspacePath?: string | null) => Promise<McpState>
  refreshServer: (serverId: string, workspacePath?: string | null) => Promise<McpState>
  updateServer: (
    serverId: string,
    input: McpAddServerInput,
    workspacePath?: string | null,
  ) => Promise<McpState>
  toggleTool: (
    serverId: string,
    toolName: string,
    enabled: boolean,
    workspacePath?: string | null,
  ) => Promise<McpState>
}
