import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { McpServerConfig, McpTool } from '../../src/types/mcp'
import { identifyMcpTools } from './toolIdentity'

export interface McpToolCatalogEntry {
  catalogId: string
  client: Client
  config: McpServerConfig
  tool: McpTool
}

/**
 * Applies the same per-server allow/deny rules used by the legacy direct
 * adapter before a tool can enter the dynamic MCP catalog.
 */
export function getEnabledMcpTools(config: McpServerConfig, tools: readonly McpTool[]) {
  const allowedToolNames = new Set(config.toolConfiguration?.allowedTools ?? [])
  const disabledToolNames = new Set(config.toolConfiguration?.disabledTools ?? [])

  return tools.filter((tool) => {
    if (allowedToolNames.size > 0 && !allowedToolNames.has(tool.name)) {
      return false
    }

    return !disabledToolNames.has(tool.name)
  })
}

export function createMcpToolCatalogEntries(
  config: McpServerConfig,
  client: Client,
  tools: readonly McpTool[],
): McpToolCatalogEntry[] {
  return identifyMcpTools(config, getEnabledMcpTools(config, tools)).map(({ catalogId, tool }) => ({
    catalogId,
    client,
    config,
    tool,
  }))
}

export function findMcpToolCatalogEntry(entries: readonly McpToolCatalogEntry[], catalogId: string) {
  return entries.find((entry) => entry.catalogId === catalogId) ?? null
}
