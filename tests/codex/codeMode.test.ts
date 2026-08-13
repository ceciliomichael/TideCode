import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { jsonSchema, tool, type ToolExecutionOptions } from 'ai'
import { CodeModeExecutor } from '../../electron/chat/shared/codeMode/executor'
import { createAgentToolBundle } from '../../electron/chat/shared/tools'
import { createToolSearchTool } from '../../electron/chat/shared/tools/metaTools'
import { createAgentToolRegistry, type AgentToolRegistry } from '../../electron/chat/shared/tools/registry'

function createTestRegistry(): AgentToolRegistry {
  const entries = [
    {
      description: 'Return the provided test value.',
      execute: async (input: unknown) => ({
        body: JSON.stringify(input),
        status: 'success' as const,
        summary: 'Returned test value.',
      }),
      inputSchema: { type: 'object' as const },
      name: 'echo',
      namespace: 'test',
    },
  ]

  return {
    entries,
    get(name) {
      return entries.find((entry) => entry.name === name)
    },
    search() {
      return entries.map((entry) => ({ ...entry, score: 1 }))
    },
  }
}

test('Code Mode runs a filtered program through the registry bridge', async () => {
  const executor = new CodeModeExecutor(createTestRegistry())

  try {
    const result = await executor.run(
      `const first = await tools.echo({ value: 'first' })
       const second = await tools.echo({ value: 'second' })
       return { first: first.body, second: second.body }`,
      { allowedToolNames: ['echo'] },
    )

    assert.equal(result.status, 'success')
    assert.equal(result.toolCalls.length, 2)
    assert.deepEqual(result.output, {
      first: JSON.stringify({ value: 'first' }),
      second: JSON.stringify({ value: 'second' }),
    })
  } finally {
    await executor.dispose()
  }
})

test('Code Mode allows more than sixteen concurrent tool calls', async () => {
  const executor = new CodeModeExecutor(createTestRegistry())

  try {
    const result = await executor.run(
      `const calls = Array.from({ length: 32 }, (_, index) => tools.echo({ index }))
       const values = await Promise.all(calls)
       return { count: values.length }`,
      { allowedToolNames: ['echo'] },
    )

    assert.equal(result.status, 'success')
    assert.equal(result.toolCalls.length, 32)
    assert.deepEqual(result.output, { count: 32 })
  } finally {
    await executor.dispose()
  }
})

test('Code Mode resolves returned tool Promises when a small model omits await', async () => {
  const executor = new CodeModeExecutor(createTestRegistry())

  try {
    const result = await executor.run(
      `const first = tools.echo({ value: 'first' })
       const second = tools.echo({ value: 'second' })
       return { first, nested: { second } }`,
      { allowedToolNames: ['echo'] },
    )

    assert.equal(result.status, 'success')
    assert.equal(result.toolCalls.length, 2)
    assert.deepEqual(result.output, {
      first: {
        body: JSON.stringify({ value: 'first' }),
        status: 'success',
        summary: 'Returned test value.',
      },
      nested: {
        second: {
          body: JSON.stringify({ value: 'second' }),
          status: 'success',
          summary: 'Returned test value.',
        },
      },
    })
  } finally {
    await executor.dispose()
  }
})

test('Code Mode explains non-serializable returned data instead of exposing a clone error', async () => {
  const executor = new CodeModeExecutor(createTestRegistry())

  try {
    const result = await executor.run('return { invalid: () => true }')

    assert.equal(result.status, 'error')
    assert.match(result.summary, /non-serializable data/u)
    assert.match(result.summary, /await every tools\.\* call/u)
  } finally {
    await executor.dispose()
  }
})

test('Code Mode surfaces failed registry tools instead of reporting false success', async () => {
  const entries = [
    {
      description: 'Return a failed test result.',
      execute: async () => ({
        status: 'error' as const,
        summary: 'The test tool failed.',
      }),
      inputSchema: { type: 'object' as const },
      name: 'failing_tool',
      namespace: 'test',
    },
  ]
  const executor = new CodeModeExecutor({
    entries,
    get(name) {
      return entries.find((entry) => entry.name === name)
    },
    search() {
      return entries.map((entry) => ({ ...entry, score: 1 }))
    },
  })

  try {
    const result = await executor.run(
      "const toolResult = await tools.failing_tool({}); return { status: toolResult.status }",
      { allowedToolNames: ['failing_tool'] },
    )

    assert.equal(result.status, 'error')
    assert.match(result.summary, /1 failed tool call/u)
    assert.deepEqual(result.output, { status: 'error' })
  } finally {
    await executor.dispose()
  }
})

test('Code Mode rejects unavailable tools before starting execution', async () => {
  const executor = new CodeModeExecutor(createTestRegistry())

  try {
    const result = await executor.run('return null', { allowedToolNames: ['missing_tool'] })

    assert.equal(result.status, 'error')
    assert.match(result.summary, /not available/u)
    assert.equal(result.toolCalls.length, 0)
  } finally {
    await executor.dispose()
  }
})

test('Code Mode rejects raw runtime APIs', async () => {
  const executor = new CodeModeExecutor(createTestRegistry())

  try {
    const result = await executor.run('return process.env')

    assert.equal(result.status, 'error')
    assert.match(result.summary, /forbidden runtime API/u)
  } finally {
    await executor.dispose()
  }
})

test('Code Mode allows forbidden words in filenames, URLs, comments, and regex literals', async () => {
  const executor = new CodeModeExecutor(createTestRegistry())

  try {
    const result = await executor.run(
      `// fs and process are allowed as data here
       const filename = 'src/types/electron.d.ts'
       const url = 'https://example.com/module'
       const pattern = /https?:\\/\\/electron/iu
       const response = await tools.echo({ filename, url, pattern: String(pattern) })
       return response.body`,
      { allowedToolNames: ['echo'] },
    )

    assert.equal(result.status, 'success')
    assert.equal(result.toolCalls.length, 1)
  } finally {
    await executor.dispose()
  }
})

test('Code Mode reports malformed template text before scanning prose for runtime APIs', async () => {
  const executor = new CodeModeExecutor(createTestRegistry())

  try {
    const result = await executor.run(
      'const content = `Architecture uses \\\\`electron/preload.ts\\\\` without raw Node/Electron access.`; return content',
    )

    assert.equal(result.status, 'error')
    assert.equal(result.toolCalls.length, 0)
    assert.match(result.summary, /invalid JavaScript/u)
    assert.doesNotMatch(result.summary, /forbidden runtime API: electron/iu)
  } finally {
    await executor.dispose()
  }
})

test('Code Mode reports generated syntax errors before starting a worker', async () => {
  const executor = new CodeModeExecutor(createTestRegistry())

  try {
    const result = await executor.run(
      `const replacements = [\n  ['target', 'replacement')\n]\nreturn replacements`,
    )

    assert.equal(result.status, 'error')
    assert.equal(result.toolCalls.length, 0)
    assert.match(result.summary, /invalid JavaScript/u)
    assert.match(result.summary, /Unexpected token '\)'/u)
    assert.match(result.summary, /sequential tools\.\* calls/u)
  } finally {
    await executor.dispose()
  }
})

test('Code Mode repairs simple malformed patch arrays before running the patch tool', async () => {
  const entries = [
    {
      description: 'Capture a patch payload.',
      execute: async (input: unknown) => ({
        body: JSON.stringify(input),
        status: 'success' as const,
        summary: 'Captured patch.',
      }),
      inputSchema: { type: 'object' as const },
      name: 'patch',
      namespace: 'filesystem',
    },
  ]
  const executor = new CodeModeExecutor({
    entries,
    get(name) {
      return entries.find((entry) => entry.name === name)
    },
    search() {
      return entries.map((entry) => ({ ...entry, score: 1 }))
    },
  })

  try {
    const malformedPatchProgram = [
      'const patch = [',
      "  '*** Begin Patch',",
      "  '*** Update File: src/example.ts',",
      "  '@@",
      "  '-old',",
      "  '+new'",
      "  '*** End Patch'",
      ']',
      'return await tools.patch({ patch })',
    ].join('\n')
    const result = await executor.run(malformedPatchProgram)

    assert.equal(result.status, 'success')
    assert.equal(result.toolCalls.length, 1)
    assert.deepEqual(result.output, {
      body: JSON.stringify({
        patch: [
          '*** Begin Patch',
          '*** Update File: src/example.ts',
          '@@',
          '-old',
          '+new',
          '*** End Patch',
        ],
      }),
      status: 'success',
      summary: 'Captured patch.',
    })
  } finally {
    await executor.dispose()
  }
})

test('the registry validates Code Mode arguments before invoking a native tool', async () => {
  let wasInvoked = false
  const registry = await createAgentToolRegistry({
    guarded: tool({
      description: 'Requires a path.',
      inputSchema: jsonSchema({
        additionalProperties: false,
        properties: { path: { type: 'string' } },
        required: ['path'],
        type: 'object',
      }),
      execute: async () => {
        wasInvoked = true
        return { status: 'success' as const, summary: 'invoked' }
      },
    }),
  })

  const result = await registry.get('guarded')?.execute({})

  assert.equal(wasInvoked, false)
  assert.equal(result?.status, 'error')
  assert.match(result?.summary ?? '', /Invalid arguments/u)
})

test('the registry maps a zero-based first-line offset to the read API contract', async () => {
  let receivedInput: unknown
  const registry = await createAgentToolRegistry({
    read: tool({
      description: 'Reads a file.',
      inputSchema: jsonSchema({
        additionalProperties: false,
        properties: { offset: { minimum: 1, type: 'number' } },
        type: 'object',
      }),
      execute: async (input) => {
        receivedInput = input
        return { status: 'success' as const, summary: 'read' }
      },
    }),
  })

  const result = await registry.get('read')?.execute({ offset: 0 })

  assert.equal(result?.status, 'success')
  assert.deepEqual(receivedInput, { offset: 1 })
})

test('Code Mode terminates a synchronous infinite loop', async () => {
  const executor = new CodeModeExecutor(createTestRegistry())

  try {
    const result = await executor.run('while (true) {}', { limits: { timeoutMs: 100 } })

    assert.equal(result.status, 'error')
    assert.match(result.summary, /Code Mode failed|timeout/u)
  } finally {
    await executor.dispose()
  }
})

test('tool_search runs inside Code Mode while local tools remain preloaded', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-code-mode-e2e-'))
  let codeModeExecutor: CodeModeExecutor | null = null

  try {
    await fs.writeFile(path.join(workspaceRootPath, 'package.json'), '{"version":"1.2.3"}\n', 'utf8')
    const bundle = await createAgentToolBundle(
      { workspaceRootPath },
      { chatMode: 'agent', orchestrationMode: 'code_mode' },
    )
    codeModeExecutor = bundle.codeModeExecutor

    type ExecutableTestTool = {
      execute?: (input: unknown, options: ToolExecutionOptions<unknown>) => Promise<unknown>
    }
    const invoke = async (tool: unknown, input: unknown) => {
      const execute = (tool as ExecutableTestTool).execute
      assert.equal(typeof execute, 'function')
      return await execute?.(input, {
        context: {},
        messages: [],
        toolCallId: 'test-code-mode',
      })
    }

    assert.deepEqual(Object.keys(bundle.tools), ['code_mode'])
    assert.ok(bundle.registry.get('tool_search'))
    assert.match(
      ((bundle.tools.code_mode as { description?: string }).description ?? ''),
      /tools\.read\(\{ path: string/u,
    )
    assert.match(
      ((bundle.tools.code_mode as { description?: string }).description ?? ''),
      /Promise<ToolResult>/u,
    )
    assert.match(
      ((bundle.tools.code_mode as { description?: string }).description ?? ''),
      /await each call/u,
    )
    assert.match(
      ((bundle.tools.code_mode as { description?: string }).description ?? ''),
      /Path rule: every path argument is one exact existing workspace-relative file or directory/u,
    )
    assert.match(
      ((bundle.tools.code_mode as { description?: string }).description ?? ''),
      /offset\?: number \(>= 1\)/u,
    )
    assert.match(
      ((bundle.tools.code_mode as { description?: string }).description ?? ''),
      /tools\.tool_search\(\{ limit\?: number/u,
    )

    const codeResult = await invoke(bundle.tools.code_mode, {
      code: "const search = await tools.tool_search({ query: 'connected memory service', limit: 5 }); const file = await tools.read({ path: 'package.json' }); return { hasVersion: file.body.includes('1.2.3'), searchStatus: search.status }",
    }) as { body?: string }
    assert.match(codeResult.body ?? '', /"hasVersion": true/u)
    assert.match(codeResult.body ?? '', /"searchStatus": "success"/u)
  } finally {
    await codeModeExecutor?.dispose()
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('Code Mode discovers and invokes an MCP tool in the same program', async () => {
  const mcpTools = {
    mcp_project_memory: tool({
      description: 'Read connected project memory.',
      inputSchema: jsonSchema<{ topic: string }>({
        additionalProperties: false,
        properties: { topic: { type: 'string' } },
        required: ['topic'],
        type: 'object',
      }),
      execute: async ({ topic }) => ({
        body: `memory:${topic}`,
        status: 'success' as const,
        summary: 'Read connected project memory.',
      }),
    }),
  }
  const searchableRegistry = await createAgentToolRegistry(mcpTools)
  const registry = await createAgentToolRegistry({
    ...mcpTools,
    tool_search: createToolSearchTool(searchableRegistry, { dynamicOnly: true }),
  })
  const executor = new CodeModeExecutor(registry, registry.entries.map((entry) => entry.name))

  try {
    const result = await executor.run(
      `const search = await tools.tool_search({ query: 'connected project memory' })
       const catalog = JSON.parse(search.body)
       const name = catalog.tools[0].name
       const memory = await tools[name]({ topic: 'architecture' })
       return { discovered: name, value: memory.body }`,
    )

    assert.equal(result.status, 'success')
    assert.deepEqual(result.output, {
      discovered: 'mcp_project_memory',
      value: 'memory:architecture',
    })
    assert.deepEqual(result.toolCalls.map((call) => call.name), [
      'tool_search',
      'mcp_project_memory',
    ])
  } finally {
    await executor.dispose()
  }
})
