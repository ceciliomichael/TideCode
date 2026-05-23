import { EventEmitter } from 'node:events'
import type { ToolSet } from 'ai'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type {
  McpAddServerInput,
  McpServerConfig,
  McpServerStatus,
  McpState,
  McpTool,
} from '../../src/types/mcp'
import { createMcpToolSetForServer } from './toolAdapter'
import { connectMcpServer } from './client'
import {
  appendMcpServerConfig,
  deleteMcpConfig,
  ensureMcpConfigExists,
  getMcpGlobalConfigPath,
  loadMergedMcpConfigs,
  replaceMcpServerConfig,
  saveMcpConfig,
} from './configStore'
import { parseMcpAddServerInput } from './configValidation'
import { getMcpStateStore } from './stateStore'

interface ManagedRuntime {
  client: Client | null
  config: McpServerConfig
  connectionSignature: string
  status: McpServerStatus
  tools: McpTool[]
  transport: Transport | null
}

function normalizeWorkspacePath(workspacePath?: string | null) {
  const trimmed = workspacePath?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

function createConnectionSignature(config: McpServerConfig) {
  return JSON.stringify({
    args: config.args ?? [],
    command: config.command ?? '',
    enabled: config.enabled,
    env: config.env ?? {},
    headers: config.headers ?? {},
    type: config.type,
    url: config.url ?? '',
  })
}

function generateServerId(name: string) {
  return `mcp-${name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`
}

function buildUpdatedConfig(currentConfig: McpServerConfig, input: McpAddServerInput): McpServerConfig {
  const parsed = parseMcpAddServerInput(input)
  if (!parsed.success || !parsed.data) {
    throw new Error(parsed.error ?? 'Unable to parse the provided MCP server input.')
  }

  const nextConfig: McpServerConfig = {
    ...currentConfig,
    ...(parsed.data.type === 'stdio'
      ? {
          args: parsed.data.args,
          command: parsed.data.command,
          env: parsed.data.env,
          headers: undefined,
          url: undefined,
        }
      : {
          args: undefined,
          command: undefined,
          env: undefined,
          headers: parsed.data.headers,
          url: parsed.data.url,
        }),
    id: generateServerId(parsed.data.serverName),
    name: parsed.data.serverName,
    type: parsed.data.type,
  }

  return nextConfig
}

function createDisconnectedStatus(serverId: string): McpServerStatus {
  return {
    serverId,
    status: 'disconnected',
  }
}

function createConnectingStatus(serverId: string): McpServerStatus {
  return {
    serverId,
    status: 'connecting',
  }
}

function createErrorStatus(serverId: string, error: string): McpServerStatus {
  return {
    error,
    serverId,
    status: 'error',
  }
}

async function closeTransport(transport: Transport | null) {
  if (!transport) {
    return
  }

  const maybeTerminable = transport as Transport & { terminateSession?: () => Promise<void> }
  if (typeof maybeTerminable.terminateSession === 'function') {
    await maybeTerminable.terminateSession().catch(() => undefined)
  }

  await transport.close().catch(() => undefined)
}

class McpWorkspaceSession {
  private readonly stateStore = getMcpStateStore()
  private configsById = new Map<string, McpServerConfig>()
  private configErrorMessage: string | null = null
  private loadPromise: Promise<void> | null = null
  private runtimesById = new Map<string, ManagedRuntime>()

  constructor(private readonly workspacePath: string | null) {}

  private async syncFromDisk() {
    try {
      const configs = await loadMergedMcpConfigs()
      const storedAutoConnect = await this.stateStore.readAutoConnectMap(this.workspacePath)

      const nextConfigsById = new Map<string, McpServerConfig>()
      for (const config of configs) {
        nextConfigsById.set(config.id, {
          ...config,
          autoConnect: Boolean(storedAutoConnect[config.name]?.autoConnect),
        })
      }

      const nextIds = new Set(nextConfigsById.keys())

      for (const [serverId, runtime] of Array.from(this.runtimesById.entries())) {
        if (!nextIds.has(serverId)) {
          await this.disconnectRuntime(serverId, runtime, true)
          this.runtimesById.delete(serverId)
        }
      }

      this.configsById = nextConfigsById
      this.configErrorMessage = null

      for (const config of nextConfigsById.values()) {
        const runtime = this.runtimesById.get(config.id)
        const connectionSignature = createConnectionSignature(config)

        if (!runtime) {
          this.runtimesById.set(config.id, {
            client: null,
            config,
            connectionSignature,
            status: createDisconnectedStatus(config.id),
            tools: [],
            transport: null,
          })
          continue
        }

        runtime.config = config

        if (!config.enabled) {
          if (runtime.status.status === 'connected' || runtime.status.status === 'connecting') {
            await this.disconnectRuntime(config.id, runtime, false)
          }

          runtime.connectionSignature = connectionSignature
          continue
        }

        const signatureChanged = runtime.connectionSignature !== connectionSignature
        const shouldReconnect = config.autoConnect && signatureChanged && runtime.status.status === 'connected'
        const shouldConnect = config.autoConnect && runtime.status.status !== 'connected'

        if (shouldReconnect) {
          await this.disconnectRuntime(config.id, runtime, false)
          await this.connectRuntime(config.id, config)
          continue
        }

        if (shouldConnect) {
          await this.connectRuntime(config.id, config)
          continue
        }

        runtime.connectionSignature = connectionSignature
      }
    } catch (error) {
      this.configErrorMessage =
        error instanceof Error && error.message.trim().length > 0 ? error.message : 'Unable to load MCP servers.'
    }
  }

  private async ensureLoaded() {
    if (!this.loadPromise) {
      this.loadPromise = this.syncFromDisk().finally(() => {
        this.loadPromise = null
      })
    }

    await this.loadPromise
  }

  private getRuntime(serverId: string) {
    return this.runtimesById.get(serverId) ?? null
  }

  private async connectRuntime(serverId: string, config: McpServerConfig) {
    const currentRuntime = this.runtimesById.get(serverId)
    if (currentRuntime?.status.status === 'connected') {
      return currentRuntime
    }

    const nextRuntime: ManagedRuntime = currentRuntime ?? {
      client: null,
      config,
      connectionSignature: createConnectionSignature(config),
      status: createDisconnectedStatus(serverId),
      tools: [],
      transport: null,
    }

    nextRuntime.status = createConnectingStatus(serverId)
    this.runtimesById.set(serverId, nextRuntime)

    try {
      const connected = await connectMcpServer(config, this.workspacePath)
      nextRuntime.client = connected.client
      nextRuntime.transport = connected.transport
      nextRuntime.tools = connected.tools
      nextRuntime.connectionSignature = createConnectionSignature(config)
      nextRuntime.status = {
        connectedAt: Date.now(),
        serverId,
        status: 'connected',
        toolCount: connected.tools.length,
        tools: connected.tools,
      }
      return nextRuntime
    } catch (error) {
      if (nextRuntime.client) {
        await nextRuntime.client.close().catch(() => undefined)
      }
      if (nextRuntime.transport) {
        await closeTransport(nextRuntime.transport)
      }
      const errorMessage =
        error instanceof Error && error.message.trim().length > 0 ? error.message : 'Unable to connect MCP server.'
      nextRuntime.client = null
      nextRuntime.transport = null
      nextRuntime.tools = []
      nextRuntime.status = createErrorStatus(serverId, errorMessage)
      throw error
    }
  }

  private async disconnectRuntime(serverId: string, runtime: ManagedRuntime, deleteAfterDisconnect: boolean) {
    if (runtime.client) {
      await runtime.client.close().catch(() => undefined)
    }

    if (runtime.transport) {
      await closeTransport(runtime.transport)
    }

    runtime.client = null
    runtime.transport = null
    runtime.status = createDisconnectedStatus(serverId)
    runtime.connectionSignature = createConnectionSignature(runtime.config)

    if (deleteAfterDisconnect) {
      this.runtimesById.delete(serverId)
    }
  }

  private buildState(): McpState {
    const configs = Array.from(this.configsById.values()).sort((left, right) => left.name.localeCompare(right.name))
    const statuses: Record<string, McpServerStatus> = {}

    for (const config of configs) {
      const runtime = this.runtimesById.get(config.id)
      statuses[config.id] = runtime?.status ?? createDisconnectedStatus(config.id)
    }

    for (const [serverId, runtime] of this.runtimesById.entries()) {
      if (!statuses[serverId]) {
        statuses[serverId] = runtime.status
      }
    }

    return {
      configs,
      errorMessage: this.configErrorMessage,
      statuses,
    }
  }

  async getState() {
    await this.ensureLoaded()
    return this.buildState()
  }

  async addServer(input: McpAddServerInput) {
    await this.ensureLoaded()
    await appendMcpServerConfig(input)
    return this.reload()
  }

  async updateServer(serverId: string, input: McpAddServerInput) {
    await this.ensureLoaded()
    const runtime = this.getRuntime(serverId)
    const config = this.configsById.get(serverId)

    if (!runtime || !config) {
      throw new Error(`MCP server not found: ${serverId}`)
    }

    if (config.isReadOnly || config.owner !== 'echosphere') {
      throw new Error(`MCP server "${config.name}" is managed by ${config.owner} and is read-only in EchoSphere.`)
    }

    const nextConfig = buildUpdatedConfig(config, input)
    const shouldReconnect = runtime.status.status === 'connected' || runtime.status.status === 'connecting'

    await replaceMcpServerConfig(config.name, nextConfig)

    const currentAutoConnect = config.autoConnect
    if (nextConfig.name !== config.name) {
      await this.stateStore.removeServer(config.name, this.workspacePath)
    }
    await this.stateStore.setAutoConnect(nextConfig.name, currentAutoConnect, this.workspacePath)

    await this.disconnectRuntime(serverId, runtime, true)
    this.configsById.delete(serverId)
    this.configsById.set(nextConfig.id, nextConfig)
    this.runtimesById.set(nextConfig.id, {
      client: null,
      config: nextConfig,
      connectionSignature: createConnectionSignature(nextConfig),
      status: createDisconnectedStatus(nextConfig.id),
      tools: [],
      transport: null,
    })

    if (shouldReconnect && nextConfig.enabled && nextConfig.autoConnect) {
      await this.connectRuntime(nextConfig.id, nextConfig)
    }

    return this.reload()
  }

  async connectServer(serverId: string) {
    await this.ensureLoaded()
    const runtime = this.getRuntime(serverId)
    const config = this.configsById.get(serverId)

    if (!runtime || !config) {
      throw new Error(`MCP server not found: ${serverId}`)
    }

    if (!config.enabled) {
      throw new Error(`MCP server "${config.name}" is disabled in configuration.`)
    }

    await this.stateStore.setAutoConnect(config.name, true, this.workspacePath)
    const nextConfig = {
      ...config,
      autoConnect: true,
    }
    this.configsById.set(serverId, nextConfig)
    await this.connectRuntime(serverId, nextConfig)
    return this.buildState()
  }

  async disconnectServer(serverId: string) {
    await this.ensureLoaded()
    const runtime = this.getRuntime(serverId)
    const config = this.configsById.get(serverId)

    if (!runtime || !config) {
      throw new Error(`MCP server not found: ${serverId}`)
    }

    await this.stateStore.setAutoConnect(config.name, false, this.workspacePath)
    const nextConfig = {
      ...config,
      autoConnect: false,
    }
    this.configsById.set(serverId, nextConfig)
    await this.disconnectRuntime(serverId, runtime, false)
    return this.buildState()
  }

  async removeServer(serverId: string) {
    await this.ensureLoaded()
    const runtime = this.getRuntime(serverId)
    const config = this.configsById.get(serverId)

    if (!runtime || !config) {
      throw new Error(`MCP server not found: ${serverId}`)
    }

    if (config.isReadOnly || config.owner !== 'echosphere') {
      throw new Error(`MCP server "${config.name}" is managed by ${config.owner} and cannot be removed from EchoSphere.`)
    }

    await this.disconnectRuntime(serverId, runtime, true)
    await deleteMcpConfig(serverId)
    await this.stateStore.removeServer(config.name, this.workspacePath)
    return this.reload()
  }

  async refreshServer(serverId: string) {
    await this.ensureLoaded()
    const runtime = this.getRuntime(serverId)
    const config = this.configsById.get(serverId)

    if (!runtime || !config) {
      throw new Error(`MCP server not found: ${serverId}`)
    }

    if (runtime.status.status === 'connected') {
      await this.disconnectRuntime(serverId, runtime, false)
    }

    if (config.enabled && config.autoConnect) {
      await this.connectRuntime(serverId, config)
    }

    return this.buildState()
  }

  async toggleTool(serverId: string, toolName: string, enabled: boolean) {
    await this.ensureLoaded()
    const config = this.configsById.get(serverId)

    if (!config) {
      throw new Error(`MCP server not found: ${serverId}`)
    }

    if (config.isReadOnly || config.owner !== 'echosphere') {
      throw new Error(`MCP server "${config.name}" is managed by ${config.owner} and its tool overrides are read-only in EchoSphere.`)
    }

    const currentDisabledTools = new Set(config.toolConfiguration?.disabledTools ?? [])
    const currentAllowedTools = new Set(config.toolConfiguration?.allowedTools ?? [])

    if (enabled) {
      currentDisabledTools.delete(toolName)
      if (currentAllowedTools.size > 0) {
        currentAllowedTools.add(toolName)
      }
    } else {
      currentDisabledTools.add(toolName)
      if (currentAllowedTools.size > 0) {
        currentAllowedTools.delete(toolName)
      }
    }

    const nextToolConfiguration =
      currentDisabledTools.size === 0 && currentAllowedTools.size === 0
        ? undefined
        : {
            enabled: true,
            ...(currentAllowedTools.size > 0 ? { allowedTools: Array.from(currentAllowedTools).sort() } : {}),
            ...(currentDisabledTools.size > 0 ? { disabledTools: Array.from(currentDisabledTools).sort() } : {}),
          }

    const nextConfig: McpServerConfig = {
      ...config,
      ...(nextToolConfiguration ? { toolConfiguration: nextToolConfiguration } : { toolConfiguration: undefined }),
    }

    this.configsById.set(serverId, nextConfig)
    const runtime = this.runtimesById.get(serverId)
    if (runtime) {
      runtime.config = nextConfig
    }
    await saveMcpConfig(nextConfig)
    return this.buildState()
  }

  async getToolSet(): Promise<ToolSet> {
    await this.ensureLoaded()
    const toolSet: ToolSet = {}

    for (const runtime of this.runtimesById.values()) {
      if (runtime.status.status !== 'connected' || !runtime.client) {
        continue
      }

      Object.assign(toolSet, createMcpToolSetForServer(runtime.config, runtime.client, runtime.tools))
    }

    return toolSet
  }

  async reload() {
    await this.syncFromDisk()
    return this.buildState()
  }

  async dispose() {
    for (const runtime of this.runtimesById.values()) {
      await this.disconnectRuntime(runtime.config.id, runtime, true)
    }
    this.runtimesById.clear()
  }
}

export class McpServerManager {
  private readonly workspaceSessions = new Map<string, McpWorkspaceSession>()
  private readonly emitter = new EventEmitter()

  private getSessionKey(workspacePath?: string | null) {
    return normalizeWorkspacePath(workspacePath) ?? '__global__'
  }

  private getSession(workspacePath?: string | null) {
    const key = this.getSessionKey(workspacePath)
    let session = this.workspaceSessions.get(key)
    if (!session) {
      session = new McpWorkspaceSession(normalizeWorkspacePath(workspacePath))
      this.workspaceSessions.set(key, session)
    }

    return session
  }

  onStateChange(listener: (payload: { state: McpState; workspacePath: string | null }) => void) {
    this.emitter.on('state', listener)
    return () => {
      this.emitter.off('state', listener)
    }
  }

  async ensureConfigExists(workspacePath?: string | null) {
    void workspacePath
    await ensureMcpConfigExists()
  }

  async getState(workspacePath?: string | null) {
    const session = this.getSession(workspacePath)
    const state = await session.getState()
    this.emitter.emit('state', {
      state,
      workspacePath: normalizeWorkspacePath(workspacePath),
    })
    return state
  }

  async connectServer(serverId: string, workspacePath?: string | null) {
    const state = await this.getSession(workspacePath).connectServer(serverId)
    this.emitter.emit('state', {
      state,
      workspacePath: normalizeWorkspacePath(workspacePath),
    })
    return state
  }

  async disconnectServer(serverId: string, workspacePath?: string | null) {
    const state = await this.getSession(workspacePath).disconnectServer(serverId)
    this.emitter.emit('state', {
      state,
      workspacePath: normalizeWorkspacePath(workspacePath),
    })
    return state
  }

  async removeServer(serverId: string, workspacePath?: string | null) {
    const state = await this.getSession(workspacePath).removeServer(serverId)
    this.emitter.emit('state', {
      state,
      workspacePath: normalizeWorkspacePath(workspacePath),
    })
    return state
  }

  async refreshServer(serverId: string, workspacePath?: string | null) {
    const state = await this.getSession(workspacePath).refreshServer(serverId)
    this.emitter.emit('state', {
      state,
      workspacePath: normalizeWorkspacePath(workspacePath),
    })
    return state
  }

  async toggleTool(serverId: string, toolName: string, enabled: boolean, workspacePath?: string | null) {
    const state = await this.getSession(workspacePath).toggleTool(serverId, toolName, enabled)
    this.emitter.emit('state', {
      state,
      workspacePath: normalizeWorkspacePath(workspacePath),
    })
    return state
  }

  async getToolSet(workspacePath?: string | null) {
    return this.getSession(workspacePath).getToolSet()
  }

  async addServer(input: McpAddServerInput, workspacePath?: string | null) {
    const state = await this.getSession(workspacePath).addServer(input)
    this.emitter.emit('state', {
      state,
      workspacePath: normalizeWorkspacePath(workspacePath),
    })
    return state
  }

  async updateServer(serverId: string, input: McpAddServerInput, workspacePath?: string | null) {
    const state = await this.getSession(workspacePath).updateServer(serverId, input)
    this.emitter.emit('state', {
      state,
      workspacePath: normalizeWorkspacePath(workspacePath),
    })
    return state
  }

  async reload(workspacePath?: string | null) {
    const state = await this.getSession(workspacePath).reload()
    this.emitter.emit('state', {
      state,
      workspacePath: normalizeWorkspacePath(workspacePath),
    })
    return state
  }

  async dispose() {
    for (const session of this.workspaceSessions.values()) {
      await session.dispose()
    }
    this.workspaceSessions.clear()
  }

  getConfigPath(workspacePath?: string | null) {
    void workspacePath
    return getMcpGlobalConfigPath()
  }

  getGlobalConfigPath() {
    return getMcpGlobalConfigPath()
  }
}

let mcpServerManagerInstance: McpServerManager | null = null

export function getMcpServerManager() {
  if (!mcpServerManagerInstance) {
    mcpServerManagerInstance = new McpServerManager()
  }

  return mcpServerManagerInstance
}

export async function resetMcpServerManager() {
  if (!mcpServerManagerInstance) {
    return
  }

  await mcpServerManagerInstance.dispose()
  mcpServerManagerInstance = null
}
