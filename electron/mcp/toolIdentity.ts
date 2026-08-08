import type { McpServerConfig, McpTool } from '../../src/types/mcp'
import {
  appendMcpHashSuffix,
  createMcpCatalogToolName,
  createMcpToolSegment,
  normalizeMcpIdentitySegment,
  MCP_SERVER_NAMESPACE_MAX_LENGTH,
  MCP_TOOL_SEGMENT_MAX_LENGTH,
} from './mcpNaming'

export interface IdentifiedMcpTool {
  catalogId: string
  tool: McpTool
}

function createServerSegment(config: McpServerConfig) {
  return normalizeMcpIdentitySegment(
    config.toolNamespace || config.name,
    'server',
    MCP_SERVER_NAMESPACE_MAX_LENGTH,
  )
}

/**
 * Creates stable private-catalog IDs. Exact duplicate MCP names are invalid
 * because tools/call dispatches by that original name and cannot distinguish
 * duplicate definitions. Distinct names that sanitize identically receive a
 * deterministic hash suffix.
 */
export function identifyMcpTools(config: McpServerConfig, tools: readonly McpTool[]): IdentifiedMcpTool[] {
  const names = new Set<string>()
  for (const tool of tools) {
    if (names.has(tool.name)) {
      throw new Error(`MCP server "${config.name}" returned duplicate tool name "${tool.name}".`)
    }
    names.add(tool.name)
  }

  const serverSegment = createServerSegment(config)
  const toolsByBaseId = new Map<string, McpTool[]>()
  for (const tool of tools) {
    const toolSegment = createMcpToolSegment(tool.name)
    const baseId = createMcpCatalogToolName(serverSegment, toolSegment)
    const matches = toolsByBaseId.get(baseId) ?? []
    matches.push(tool)
    toolsByBaseId.set(baseId, matches)
  }

  const identified: IdentifiedMcpTool[] = []
  const assignedIds = new Set<string>()
  for (const [baseId, matches] of toolsByBaseId.entries()) {
    for (const tool of matches) {
      const catalogId =
        matches.length === 1
          ? baseId
          : createMcpCatalogToolName(
              serverSegment,
              appendMcpHashSuffix(createMcpToolSegment(tool.name), tool.name, MCP_TOOL_SEGMENT_MAX_LENGTH),
            )
      if (assignedIds.has(catalogId)) {
        throw new Error(`MCP catalog ID collision for "${catalogId}" on server "${config.name}".`)
      }
      assignedIds.add(catalogId)
      identified.push({ catalogId, tool })
    }
  }

  return identified.sort((left, right) => left.catalogId.localeCompare(right.catalogId))
}
