import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { McpToolCatalogEntry } from './mcpToolCatalog'

export interface McpToolExecutionOutput {
  body: string
  isError: boolean
  serverName: string
  toolId: string
  toolName: string
}

function formatStructuredContent(value: unknown) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return ''
  }
}

export function toMcpToolBody(result: CallToolResult) {
  const lines: string[] = []
  for (const item of result.content ?? []) {
    if (item.type === 'text') {
      lines.push(item.text)
      continue
    }

    if (item.type === 'image') {
      lines.push(`[Image: ${item.mimeType}]`)
      continue
    }

    if (item.type === 'resource') {
      lines.push(`[Resource: ${item.resource.uri}]`)
      continue
    }

    if (item.type === 'audio') {
      lines.push(`[Audio: ${item.mimeType}]`)
      continue
    }

    lines.push(JSON.stringify(item))
  }

  const body = lines.join('\n').trim()
  if (body.length > 0) {
    return body
  }

  if (result.structuredContent !== undefined) {
    return formatStructuredContent(result.structuredContent)
  }

  return ''
}

export async function executeMcpTool(
  entry: McpToolCatalogEntry,
  argumentsValue: Record<string, unknown>,
): Promise<McpToolExecutionOutput> {
  const result = await entry.client.callTool({
    arguments: argumentsValue,
    name: entry.tool.name,
  }) as CallToolResult
  return {
    body: toMcpToolBody(result),
    isError: Boolean(result.isError),
    serverName: entry.config.name,
    toolId: entry.catalogId,
    toolName: entry.tool.name,
  }
}
