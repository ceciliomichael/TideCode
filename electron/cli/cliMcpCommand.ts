import type { McpServerConfig } from '../../src/types/mcp'
import { saveMcpConfig } from '../mcp/configStore'
import { getMcpServerManager } from '../mcp/serverManager'
import type { CliSessionState, SlashCommandHelpers } from './types'

function isToolEnabled(config: McpServerConfig, toolName: string): boolean {
  const allowed = config.toolConfiguration?.allowedTools ?? []
  const disabled = config.toolConfiguration?.disabledTools ?? []
  return (allowed.length === 0 || allowed.includes(toolName)) && !disabled.includes(toolName)
}

export function buildCliMcpConfigUpdate(
  config: McpServerConfig,
  toolNames: readonly string[],
  enabledItems: ReadonlySet<string>,
  serverToggleId = '__server_enabled__',
): McpServerConfig {
  const knownToolNames = new Set(toolNames)
  const existingDisabled = config.toolConfiguration?.disabledTools ?? []
  const disabledTools = new Set(existingDisabled.filter((toolName) => !knownToolNames.has(toolName)))
  for (const toolName of toolNames) {
    if (!enabledItems.has(toolName)) disabledTools.add(toolName)
  }
  const existingAllowed = config.toolConfiguration?.allowedTools ?? []
  const allowedTools = existingAllowed.length > 0
    ? toolNames.filter((toolName) => enabledItems.has(toolName))
    : []
  return {
    ...config,
    enabled: enabledItems.has(serverToggleId),
    toolConfiguration: disabledTools.size > 0 || allowedTools.length > 0
      ? {
          enabled: true,
          ...(allowedTools.length > 0 ? { allowedTools: allowedTools.sort() } : {}),
          ...(disabledTools.size > 0 ? { disabledTools: Array.from(disabledTools).sort() } : {}),
        }
      : undefined,
  }
}

export async function runCliMcpCommand(state: CliSessionState, helpers: SlashCommandHelpers): Promise<void> {
  const manager = getMcpServerManager()
  const mcpState = await manager.getState(state.workspaceRootPath)
  if (mcpState.errorMessage) helpers.renderWarning(mcpState.errorMessage)
  if (mcpState.configs.length === 0) {
    helpers.renderInfo('No MCP servers are configured.')
    return
  }

  const serverId = await helpers.select<string>({
    title: 'MCP Servers',
    items: mcpState.configs.map((config) => {
      const status = mcpState.statuses[config.id]
      return {
        value: config.id,
        label: config.name,
        description: `${config.enabled ? 'enabled' : 'disabled'} · ${status?.status ?? 'disconnected'} · ${status?.tools?.length ?? 0} tools`,
        badge: config.isReadOnly ? '[external]' : '[TideCode]',
      }
    }),
    pageSize: 10,
  })
  if (!serverId) return
  const config = mcpState.configs.find((candidate) => candidate.id === serverId)
  if (!config) return
  const tools = mcpState.statuses[serverId]?.tools ?? []
  const serverToggleId = '__server_enabled__'
  const enabledItems = await helpers.checklist<string>({
    title: `MCP · ${config.name}`,
    items: [
      {
        value: serverToggleId,
        label: 'Entire server',
        description: config.enabled ? 'Server and enabled tools are available' : 'Server is disabled',
        enabled: config.enabled,
        readOnly: config.isReadOnly,
      },
      ...tools.map((tool) => ({
        value: tool.name,
        label: tool.name,
        description: tool.description,
        enabled: isToolEnabled(config, tool.name),
        readOnly: config.isReadOnly,
      })),
    ],
    pageSize: 12,
    footer: config.isReadOnly
      ? `Managed by ${config.owner}; change it in the owning app's MCP config`
      : tools.length === 0
        ? 'Connect this server to discover and configure its tools'
        : 'Server and tool state is shared across TideCode',
  })
  if (!enabledItems || config.isReadOnly) return

  const enabled = new Set(enabledItems)
  const nextConfig = buildCliMcpConfigUpdate(config, tools.map((tool) => tool.name), enabled, serverToggleId)
  await saveMcpConfig(nextConfig)
  await manager.reload(state.workspaceRootPath)
  helpers.renderSuccess(`${config.name} MCP settings saved.`)
}
