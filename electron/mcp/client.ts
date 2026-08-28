import { electronApp } from '../electronApp'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { McpServerConfig, McpTool } from '../../src/types/mcp'
import { createMcpTransport } from './transportFactory'
import { TIDECODE_VERSION } from '../appVersion'

const MCP_CONNECTION_TIMEOUT_MS = 30_000

export interface ConnectedMcpServer {
  client: Client
  tools: McpTool[]
  transport: Transport
}

function toMcpTool(tool: {
  description?: string
  inputSchema: Record<string, unknown>
  name: string
  outputSchema?: Record<string, unknown>
  title?: string
}) {
  return {
    description: tool.description,
    inputSchema: tool.inputSchema,
    name: tool.name,
    outputSchema: tool.outputSchema,
    title: tool.title,
  }
}

export async function connectMcpServer(
  config: McpServerConfig,
  workspacePath?: string | null,
  onToolsChanged?: (tools: McpTool[]) => void,
): Promise<ConnectedMcpServer> {
  const transport = createMcpTransport(config, workspacePath)
  const client = new Client(
    {
      name: (typeof electronApp.getName === 'function' ? electronApp.getName() : null) || 'TideCode',
      version: (typeof electronApp.getVersion === 'function' ? electronApp.getVersion() : null) || TIDECODE_VERSION,
    },
    {
      capabilities: {
        roots: {
          listChanged: true,
        },
      },
      listChanged: {
        tools: {
          autoRefresh: true,
          debounceMs: 100,
          onChanged: (tools) => {
            if (!Array.isArray(tools)) {
              if (tools instanceof Error) {
                console.error(`Failed to refresh MCP tools for server "${config.name}".`, tools)
              }
              return
            }
            onToolsChanged?.(tools.map((tool) => toMcpTool(tool)))
          },
        },
      },
    },
  )

  await client.connect(transport, {
    maxTotalTimeout: MCP_CONNECTION_TIMEOUT_MS,
    timeout: MCP_CONNECTION_TIMEOUT_MS,
  })
  const result = await client.listTools(undefined, {
    maxTotalTimeout: MCP_CONNECTION_TIMEOUT_MS,
    timeout: MCP_CONNECTION_TIMEOUT_MS,
  })

  return {
    client,
    tools: result.tools.map((tool) => toMcpTool(tool)),
    transport,
  }
}
