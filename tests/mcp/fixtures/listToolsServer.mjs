import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const server = new Server(
  { name: 'tidecode-test-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      description: 'List test routes.',
      inputSchema: { additionalProperties: false, properties: {}, type: 'object' },
      name: 'list_routes',
    },
  ],
}))

await server.connect(new StdioServerTransport())
