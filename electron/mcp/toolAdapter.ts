import { jsonSchema, tool, type ToolSet } from 'ai'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { McpServerConfig, McpTool } from '../../src/types/mcp'
import type { AgentToolExecutionResult } from '../chat/shared/toolTypes'

function createSuccessResult(input: Omit<AgentToolExecutionResult, 'status'>): AgentToolExecutionResult {
  return {
    ...input,
    status: 'success',
  }
}

function createErrorResult(summary: string, body?: string): AgentToolExecutionResult {
  return {
    ...(body ? { body } : {}),
    status: 'error',
    summary,
  }
}

function toToolBody(content: CallToolResult['content']) {
  const lines: string[] = []
  for (const item of content) {
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

  return lines.join('\n').trim()
}

function createNamespacedToolName(toolName: string) {
  const normalizedToolName = toolName.trim().replace(/[^a-zA-Z0-9_-]+/g, '_')
  return `mcp_${normalizedToolName}`
}

function createToolDescription(config: McpServerConfig, tool: McpTool) {
  const baseDescription = tool.description?.trim() ?? ''
  const sourceLabel = config.owner === 'echosphere' ? 'global' : config.owner
  return baseDescription.length > 0 ? `[${sourceLabel}] ${baseDescription}` : `[${sourceLabel}] MCP tool`
}

export function createMcpToolSetForServer(config: McpServerConfig, client: Client, tools: McpTool[]): ToolSet {
  const enabledToolNames = new Set(config.toolConfiguration?.allowedTools ?? [])
  const disabledToolNames = new Set(config.toolConfiguration?.disabledTools ?? [])

  return Object.fromEntries(
    tools
      .filter((tool) => {
        if (enabledToolNames.size > 0 && !enabledToolNames.has(tool.name)) {
          return false
        }

        if (disabledToolNames.has(tool.name)) {
          return false
        }

        return true
      })
      .map((mcpTool) => {
        const toolName = createNamespacedToolName(mcpTool.name)
        return [
          toolName,
          tool({
            description: createToolDescription(config, mcpTool),
            inputSchema: jsonSchema(mcpTool.inputSchema),
            execute: async (rawInput) => {
              try {
                const result = await client.callTool({
                  arguments: rawInput as Record<string, unknown>,
                  name: mcpTool.name,
                })

                const body = toToolBody(result.content as CallToolResult['content'])
                if (result.isError) {
                  return createErrorResult(
                    `MCP tool ${mcpTool.name} failed.`,
                    body.length > 0 ? body : undefined,
                  )
                }

                return createSuccessResult({
                  ...(body.length > 0 ? { body } : {}),
                  summary: body.length > 0 ? `Completed ${mcpTool.name}` : `Completed ${mcpTool.name}`,
                })
              } catch (error) {
                const message = error instanceof Error && error.message.trim().length > 0 ? error.message : 'Tool call failed.'
                return createErrorResult(`MCP tool ${mcpTool.name} failed.`, message)
              }
            },
          }),
        ] as const
      }),
  )
}
