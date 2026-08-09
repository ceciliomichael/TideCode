import assert from 'node:assert/strict'
import test from 'node:test'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { McpServerConfig } from '../../src/types/mcp'
import { createMcpToolCatalogEntries } from '../../electron/mcp/mcpToolCatalog'
import { executeMcpTool } from '../../electron/mcp/mcpToolExecution'
import { searchMcpToolCatalog } from '../../electron/mcp/mcpToolSearch'

function createConfig(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    autoConnect: true,
    enabled: true,
    id: 'mcp-stripe',
    isReadOnly: false,
    name: 'Stripe',
    owner: 'tidecode',
    source: 'global',
    toolNamespace: 'stripe',
    type: 'stdio',
    ...overrides,
  }
}

function createClient(callTool: Client['callTool']): Client {
  return { callTool } as unknown as Client
}

test('MCP search ranks natural-language capability matches and hides schemas by default', () => {
  const client = createClient(async () => ({ content: [], isError: false }))
  const entries = createMcpToolCatalogEntries(createConfig(), client, [
    {
      description: 'Create and send an invoice to a customer.',
      inputSchema: {
        properties: { customer: { type: 'string' } },
        required: ['customer'],
        type: 'object',
      },
      name: 'create_invoice',
    },
    {
      description: 'Look up a customer by email address.',
      inputSchema: { type: 'object' },
      name: 'find_customer',
    },
  ])

  const result = searchMcpToolCatalog(entries, {
    include_schema: false,
    limit: 5,
    query: 'send an invoice to a customer',
  })

  assert.equal(result.tools[0]?.tool_id, 'mcp_stripe_create_invoice')
  assert.equal(result.tools[0]?.name, 'create_invoice')
  assert.equal(result.tools[0]?.server, 'Stripe')
  assert.equal('input_schema' in (result.tools[0] ?? {}), false)
})

test('exact MCP tool searches return the requested schema and respect the limit', () => {
  const client = createClient(async () => ({ content: [], isError: false }))
  const entries = createMcpToolCatalogEntries(createConfig(), client, [
    {
      description: 'Create and send an invoice to a customer.',
      inputSchema: {
        properties: { customer: { type: 'string' } },
        required: ['customer'],
        type: 'object',
      },
      name: 'create_invoice',
    },
    {
      description: 'Create a payment intent.',
      inputSchema: { type: 'object' },
      name: 'create_payment_intent',
    },
  ])

  const result = searchMcpToolCatalog(entries, {
    include_schema: true,
    limit: 1,
    query: 'stripe.create_invoice',
  })

  assert.equal(result.tools.length, 1)
  assert.deepEqual(result.tools[0]?.input_schema, {
    properties: { customer: { type: 'string' } },
    required: ['customer'],
    type: 'object',
  })
})

test('disabled MCP tools never enter the searchable catalog', () => {
  const client = createClient(async () => ({ content: [], isError: false }))
  const entries = createMcpToolCatalogEntries(
    createConfig({
      toolConfiguration: {
        enabled: true,
        disabledTools: ['create_invoice'],
      },
    }),
    client,
    [
      {
        description: 'Create and send an invoice to a customer.',
        inputSchema: { type: 'object' },
        name: 'create_invoice',
      },
    ],
  )

  assert.deepEqual(searchMcpToolCatalog(entries, { query: 'create invoice', limit: 5 }).tools, [])
})

test('MCP execution calls the original server tool name with the supplied object', async () => {
  const calls: Array<{ arguments: Record<string, unknown>; name: string }> = []
  const client = createClient(async ({ arguments: argumentsValue, name }) => {
    calls.push({ arguments: argumentsValue as Record<string, unknown>, name })
    return {
      content: [{ text: 'invoice created', type: 'text' as const }],
      isError: false,
    }
  })
  const [entry] = createMcpToolCatalogEntries(createConfig(), client, [
    {
      description: 'Create and send an invoice to a customer.',
      inputSchema: { type: 'object' },
      name: 'create_invoice',
    },
  ])

  assert.ok(entry)
  const result = await executeMcpTool(entry, { customer: 'cus_123' })

  assert.deepEqual(result, {
    body: 'invoice created',
    isError: false,
    serverName: 'Stripe',
    toolId: 'mcp_stripe_create_invoice',
    toolName: 'create_invoice',
  })
  assert.deepEqual(calls, [{ arguments: { customer: 'cus_123' }, name: 'create_invoice' }])
})
