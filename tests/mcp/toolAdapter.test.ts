import assert from 'node:assert/strict'
import test from 'node:test'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { McpServerConfig } from '../../src/types/mcp'
import { createMcpToolSetForServer } from '../../electron/mcp/toolAdapter'
import { getMcpToolSource } from '../../electron/mcp/toolMetadata'

test('createMcpToolSetForServer namespaces tools and filters disabled entries', async () => {
  const calls: Array<{ arguments: Record<string, unknown>; name: string }> = []
  const client = {
    callTool: async ({ arguments: args, name }: { arguments: Record<string, unknown>; name: string }) => {
      calls.push({ arguments: args, name })
      return {
        content: [
          {
            text: `${name}:${JSON.stringify(args)}`,
            type: 'text' as const,
          },
        ],
        isError: false,
      }
    },
  } as unknown as Client

  const config: McpServerConfig = {
    autoConnect: false,
    enabled: true,
    id: 'server-one',
    isReadOnly: false,
    name: 'server-one',
    owner: 'tidecode',
    source: 'global',
    toolNamespace: 'srv',
    toolConfiguration: {
      enabled: true,
      disabledTools: ['hidden-tool'],
    },
    type: 'stdio',
  }

  const tools = createMcpToolSetForServer(config, client, [
    {
      inputSchema: {
        additionalProperties: false,
        properties: {
          query: {
            type: 'string',
          },
        },
        required: ['query'],
        type: 'object',
      },
      name: 'search',
    },
    {
      inputSchema: {
        additionalProperties: false,
        type: 'object',
      },
      name: 'hidden-tool',
    },
  ])

  assert.ok('mcp_srv_search' in tools)
  assert.ok(!('mcp_srv_hidden_tool' in tools))

  const tool = tools['mcp_srv_search'] as {
    execute: (input: { query: string }) => Promise<{
      body?: string
      semantics?: Record<string, unknown>
      status: string
      summary: string
    }>
  }
  const result = await tool.execute({ query: 'atlas' })

  assert.equal(result.status, 'success')
  assert.equal(result.summary, 'Completed search')
  assert.equal(result.body, 'search:{"query":"atlas"}')
  assert.deepEqual(result.semantics, {
    mcp_server_name: 'server-one',
    mcp_tool_id: 'mcp_srv_search',
    mcp_tool_name: 'search',
    operation: 'mcp_execute',
  })
  assert.deepEqual(calls, [{ arguments: { query: 'atlas' }, name: 'search' }])
  assert.deepEqual(getMcpToolSource(tool), {
    catalogName: 'mcp_srv_search',
    kind: 'mcp',
    originalToolName: 'search',
    serverId: 'server-one',
    serverName: 'server-one',
  })
  assert.match(String((tool as { description?: unknown }).description), /MCP server "server-one"/u)

})

test('same-named tools from different MCP servers retain distinct catalog IDs', () => {
  const client = {
    callTool: async () => ({ content: [], isError: false }),
  } as unknown as Client
  const createConfig = (id: string): McpServerConfig => ({
    autoConnect: false,
    enabled: true,
    id,
    isReadOnly: false,
    name: id,
    owner: 'tidecode',
    source: 'global',
    toolNamespace: id,
    type: 'stdio',
  })
  const mcpTools = [{ inputSchema: { type: 'object' }, name: 'search' }]

  const first = createMcpToolSetForServer(createConfig('github'), client, mcpTools)
  const second = createMcpToolSetForServer(createConfig('notion'), client, mcpTools)

  assert.deepEqual(Object.keys({ ...first, ...second }).sort(), ['mcp_github_search', 'mcp_notion_search'])
})

test('sanitized MCP name collisions receive stable suffixes and exact duplicates are rejected', () => {
  const client = {
    callTool: async () => ({ content: [], isError: false }),
  } as unknown as Client
  const config: McpServerConfig = {
    autoConnect: false,
    enabled: true,
    id: 'collision-server',
    isReadOnly: false,
    name: 'collision-server',
    owner: 'tidecode',
    source: 'global',
    toolNamespace: 'collision',
    type: 'stdio',
  }

  const collisionTools = createMcpToolSetForServer(config, client, [
    { inputSchema: { type: 'object' }, name: 'foo.bar' },
    { inputSchema: { type: 'object' }, name: 'foo/bar' },
  ])
  const ids = Object.keys(collisionTools)
  assert.equal(ids.length, 2)
  assert.equal(new Set(ids).size, 2)
  assert.ok(ids.every((id) => /^mcp_collision_foo_bar_[a-f0-9]{6}$/u.test(id)))

  assert.throws(
    () =>
      createMcpToolSetForServer(config, client, [
        { inputSchema: { type: 'object' }, name: 'duplicate' },
        { inputSchema: { type: 'object' }, name: 'duplicate' },
      ]),
    /duplicate tool name/u,
  )
})
