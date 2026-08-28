import assert from 'node:assert/strict'
import test from 'node:test'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { McpServerConfig, McpTool } from '../../src/types/mcp'
import { createMcpToolSetForServer } from '../../electron/mcp/toolAdapter'

test('adapted MCP tools forward AI cancellation to the SDK request', async () => {
  let receivedSignal: AbortSignal | undefined
  const client = {
    callTool: async (_params: unknown, _schema: unknown, options?: { signal?: AbortSignal }) => {
      receivedSignal = options?.signal
      await new Promise<void>((resolve) => {
        if (receivedSignal?.aborted) {
          resolve()
          return
        }
        receivedSignal?.addEventListener('abort', () => resolve(), { once: true })
      })
      const error = new Error('cancelled')
      error.name = 'AbortError'
      throw error
    },
  } as unknown as Client
  const config = {
    autoConnect: false,
    enabled: true,
    id: 'mcp-test',
    isReadOnly: false,
    name: 'Test MCP',
    owner: 'tidecode',
    source: 'global',
    toolNamespace: 'test',
    type: 'stdio',
  } as McpServerConfig
  const tools: McpTool[] = [{
    inputSchema: { type: 'object' },
    name: 'wait',
  }]
  const toolSet = createMcpToolSetForServer(config, client, tools)
  const adaptedTool = Object.values(toolSet)[0] as { execute?: (input: unknown, options?: { abortSignal?: AbortSignal }) => Promise<unknown> }
  assert.ok(adaptedTool?.execute)
  const controller = new AbortController()

  const execution = adaptedTool.execute?.({}, { abortSignal: controller.signal })
  await Promise.resolve()
  controller.abort()
  const result = await execution as { status: string }

  assert.equal(receivedSignal, controller.signal)
  assert.equal(receivedSignal?.aborted, true)
  assert.equal(result.status, 'error')
})
