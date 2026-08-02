import assert from 'node:assert/strict'
import test from 'node:test'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { McpServerConfig } from '../../src/types/mcp'
import { createMcpToolSetForServer } from '../../electron/mcp/toolAdapter'

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

  assert.ok('mcp_server-one_search' in tools)
  assert.ok(!('mcp_server-one_hidden-tool' in tools))

  const tool = tools['mcp_server-one_search'] as {
    execute: (input: { query: string }) => Promise<{ body?: string; status: string; summary: string }>
  }
  const result = await tool.execute({ query: 'atlas' })

  assert.equal(result.status, 'success')
  assert.equal(result.summary, 'Completed search')
  assert.equal(result.body, 'search:{"query":"atlas"}')
  assert.deepEqual(calls, [{ arguments: { query: 'atlas' }, name: 'search' }])

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
    type: 'stdio',
  }

  const collisionTools = createMcpToolSetForServer(config, client, [
    { inputSchema: { type: 'object' }, name: 'foo.bar' },
    { inputSchema: { type: 'object' }, name: 'foo/bar' },
  ])
  const ids = Object.keys(collisionTools)
  assert.equal(ids.length, 2)
  assert.equal(new Set(ids).size, 2)
  assert.ok(ids.every((id) => /^mcp_collision-server_foo_bar_[a-f0-9]{8}$/u.test(id)))

  assert.throws(
    () =>
      createMcpToolSetForServer(config, client, [
        { inputSchema: { type: 'object' }, name: 'duplicate' },
        { inputSchema: { type: 'object' }, name: 'duplicate' },
      ]),
    /duplicate tool name/u,
  )
})
