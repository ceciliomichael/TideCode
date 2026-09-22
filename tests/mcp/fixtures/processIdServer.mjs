import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const server = new Server(
  { name: 'tidecode-process-id-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      description: 'Return the MCP server process id.',
      inputSchema: { additionalProperties: false, properties: {}, type: 'object' },
      name: 'get_pid',
    },
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== 'get_pid') {
    throw new Error(`Unknown tool: ${request.params.name}`)
  }

  return {
    content: [{ text: String(process.pid), type: 'text' }],
  }
})

await server.connect(new StdioServerTransport())
