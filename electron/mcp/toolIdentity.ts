import { createHash } from 'node:crypto'
import type { McpServerConfig, McpTool } from '../../src/types/mcp'

export interface IdentifiedMcpTool {
  catalogId: string
  tool: McpTool
}

function normalizeIdentitySegment(value: string, fallback: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, '_')
    .replace(/_+/gu, '_')
    .replace(/^[_-]+|[_-]+$/gu, '')
  return (normalized || fallback).slice(0, 64)
}

function createStableSuffix(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, 8)
}

function createServerSegment(config: McpServerConfig) {
  const withoutGeneratedPrefix = config.id.replace(/^mcp[-_]+/iu, '')
  return normalizeIdentitySegment(withoutGeneratedPrefix || config.name, 'server')
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
    const toolSegment = normalizeIdentitySegment(tool.name, 'tool')
    const baseId = `mcp_${serverSegment}_${toolSegment}`
    const matches = toolsByBaseId.get(baseId) ?? []
    matches.push(tool)
    toolsByBaseId.set(baseId, matches)
  }

  const identified: IdentifiedMcpTool[] = []
  const assignedIds = new Set<string>()
  for (const [baseId, matches] of toolsByBaseId.entries()) {
    for (const tool of matches) {
      const catalogId = matches.length === 1 ? baseId : `${baseId}_${createStableSuffix(tool.name)}`
      if (assignedIds.has(catalogId)) {
        throw new Error(`MCP catalog ID collision for "${catalogId}" on server "${config.name}".`)
      }
      assignedIds.add(catalogId)
      identified.push({ catalogId, tool })
    }
  }

  return identified.sort((left, right) => left.catalogId.localeCompare(right.catalogId))
}
