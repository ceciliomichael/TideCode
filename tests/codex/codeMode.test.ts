import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { asSchema, jsonSchema, tool, type ToolExecutionOptions } from 'ai'
import { CodeModeExecutor } from '../../electron/chat/shared/codeMode/executor'
import { CODE_MODE_EXECUTION_CONTRACT } from '../../electron/chat/shared/codeMode/promptContract'
import { createAgentToolBundle } from '../../electron/chat/shared/tools'
import { buildCodeModeDescription, createCodeModeTool } from '../../electron/chat/shared/tools/metaTools'
import { createAgentToolRegistry, type AgentToolRegistry } from '../../electron/chat/shared/tools/registry'
import { createReadTool } from '../../electron/chat/shared/tools/readTool'

function createTerminalTestRegistry(): AgentToolRegistry {
  const entries = [
    {
      description: 'Capture a terminal command and return a running session.',
      execute: async (input: unknown) => ({
        body: JSON.stringify(input),
        semantics: { session_id: 43440, state: 'running' },
        status: 'success' as const,
        summary: 'Started terminal session 43440.',
      }),
      inputSchema: { type: 'object' as const },
      name: 'execute_terminal',
      namespace: 'terminal',
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

test('Code Mode allowedToolNames is a restrictive executable allowlist', async () => {
  let blockedCalls = 0
  const entries = [
    ...createTestRegistry().entries,
    {
      description: 'A blocked mutating tool.',
      execute: async () => {
        blockedCalls += 1
        return { status: 'success' as const, summary: 'Blocked tool ran.' }
      },
      inputSchema: { type: 'object' as const },
      name: 'write',
      namespace: 'test',
    },
  ]
  const registry: AgentToolRegistry = {
    entries,
    get(name) {
      return entries.find((entry) => entry.name === name)
    },
    search() {
      return entries.map((entry) => ({ ...entry, score: 1 }))
    },
  }
  const executor = new CodeModeExecutor(registry)

  try {
    const result = await executor.run('return await tools.write({ value: 1 })', {
      allowedToolNames: ['echo'],
    })

    assert.equal(result.status, 'error')
    assert.equal(blockedCalls, 0)
    assert.equal(result.toolCalls.length, 0)
  } finally {
    await executor.dispose()
  }
})
  } finally {
    await executor.dispose()
  }
})

test('Code Mode preserves an omitted program return as undefined', async () => {
  const executor = new CodeModeExecutor(createTestRegistry())

  try {
    const result = await executor.run("await tools.echo({ value: 'completed' })")

    assert.equal(result.status, 'success')
    assert.equal(result.output, undefined)
    assert.equal(result.toolCalls.length, 1)
  } finally {
    await executor.dispose()
  }
})

test('Code Mode supports canonical non-zero array and string indexes', async () => {
  const executor = new CodeModeExecutor(createTestRegistry())

  try {
    const result = await executor.run(
      "const values = ['zero', 'one', 'two']; const text = 'abc'; return { one: values[1], two: values[2], char: text[2] }",
    )

    assert.equal(result.status, 'success')
    assert.deepEqual(result.output, { char: 'c', one: 'one', two: 'two' })
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

test('Code Mode enforces the tool-call limit against concurrent arrivals', async () => {
  let invoked = 0
  const entries = [{
    description: 'Resolve slowly so concurrent calls arrive before earlier calls finish.',
    execute: async () => {
      invoked += 1
      await new Promise((resolve) => setTimeout(resolve, 25))
      return { status: 'success' as const, summary: 'Slow tool completed.' }
    },
    inputSchema: { type: 'object' as const },
    name: 'slow',
    namespace: 'test',
  }]
  const registry: AgentToolRegistry = {
    entries,
    get(name) {
      return entries.find((entry) => entry.name === name)
    },
    search() {
      return entries.map((entry) => ({ ...entry, score: 1 }))
    },
  }
  const executor = new CodeModeExecutor(registry)

  try {
    const result = await executor.run(
      `const calls = Array.from({ length: 20 }, () => tools.slow({}))
       const settled = await Promise.allSettled(calls)
       return {
         fulfilled: settled.filter((item) => item.status === 'fulfilled').length,
         rejected: settled.filter((item) => item.status === 'rejected').length,
       }`,
      { allowedToolNames: ['slow'], limits: { maxToolCalls: 5 } },
    )

    assert.equal(invoked, 5)
    assert.equal(result.toolCalls.length, 5)
    assert.equal(result.status, 'success')
    assert.deepEqual(result.output, { fulfilled: 5, rejected: 15 })
  } finally {
    await executor.dispose()
  }
})

test('Code Mode counts serialized same-file edits as logical tool calls', async () => {
  let invoked = 0
  const entries = [{
    description: 'Capture a synthetic edit invocation.',
    execute: async () => {
      invoked += 1
      return { status: 'success' as const, summary: 'Synthetic edit completed.' }
    },
    inputSchema: { type: 'object' as const },
    name: 'edit',
    namespace: 'filesystem',
  }]
  const registry: AgentToolRegistry = {
    entries,
    get(name) {
      return entries.find((entry) => entry.name === name)
    },
    search() {
      return entries.map((entry) => ({ ...entry, score: 1 }))
    },
  }
  const executor = new CodeModeExecutor(registry)

  try {
    const result = await executor.run(`
      const settled = await Promise.allSettled([
        tools.edit({ path: 'target.ts', edits: [{ targetContent: 'a', replacementContent: 'b' }] }),
        tools.edit({ path: 'target.ts', edits: [{ targetContent: 'c', replacementContent: 'd' }] }),
      ])
      return {
        fulfilled: settled.filter((item) => item.status === 'fulfilled').length,
        rejected: settled.filter((item) => item.status === 'rejected').length,
      }
    `, { limits: { maxToolCalls: 1 } })

    assert.equal(invoked, 1)
    assert.equal(result.toolCalls.length, 1)
    assert.equal(result.status, 'success')
    assert.deepEqual(result.output, { fulfilled: 1, rejected: 1 })
  } finally {
    await executor.dispose()
  }
})

test('Code Mode awaits bare tool-call expression statements before completing', async () => {
  const invoked: number[] = []
  const entries = [{
    description: 'Resolve slowly and record the requested sequence number.',
    execute: async (input: unknown) => {
      const value = typeof input === 'object' && input !== null && 'value' in input
        ? Number((input as { value?: unknown }).value)
        : 0
      invoked.push(value)
      await new Promise((resolve) => setTimeout(resolve, 20))
      return { body: String(value), status: 'success' as const, summary: `Completed ${value}.` }
    },
    inputSchema: { type: 'object' as const },
    name: 'slow',
    namespace: 'test',
  }]
  const registry: AgentToolRegistry = {
    entries,
    get(name) {
      return entries.find((entry) => entry.name === name)
    },
    search() {
      return entries.map((entry) => ({ ...entry, score: 1 }))
    },
  }
  const executor = new CodeModeExecutor(registry)

  try {
    const result = await executor.run(
      'tools.slow({ value: 1 }); tools.slow({ value: 2 }); return true',
      { allowedToolNames: ['slow'] },
    )

    assert.equal(result.status, 'success')
    assert.deepEqual(invoked, [1, 2])
    assert.equal(result.toolCalls.length, 2)
    assert.deepEqual(
      result.toolCalls.map((call) => ({ ...(call.arguments as { value: number }) })),
      [{ value: 1 }, { value: 2 }],
    )
    assert.match(result.summary, /2 tool calls/u)
  } finally {
    await executor.dispose()
  }
})

test('Code Mode rejects un-awaited tool Promises embedded in returned data', async () => {
  const executor = new CodeModeExecutor(createTestRegistry())

  try {
    const result = await executor.run(
      `const first = tools.echo({ value: 'first' })
       const second = tools.echo({ value: 'second' })
       return { first, nested: { second } }`,
      { allowedToolNames: ['echo'] },
    )

    assert.equal(result.status, 'error')
    assert.equal(result.toolCalls.length, 2)
    assert.match(result.summary, /un-awaited Promise/u)
    assert.equal(result.output, undefined)
  } finally {
    await executor.dispose()
  }
})

test('Code Mode reports bare tool calls without exposing an undefined result', async () => {
  const registry = createTestRegistry()
  const executor = new CodeModeExecutor(registry)
  const codeModeTool = createCodeModeTool(executor, registry)

  try {
    type ExecutableTestTool = {
      execute?: (input: unknown, options: ToolExecutionOptions<unknown>) => Promise<unknown>
    }
    const execute = (codeModeTool as unknown as ExecutableTestTool).execute
    assert.equal(typeof execute, 'function')

    const result = await execute?.(
      { source: "tools.echo({ value: 'completed' })" },
      {
        context: {},
        messages: [],
        toolCallId: 'test-code-mode-bare-call',
      },
    ) as { body?: string }

    assert.match(result.body ?? '', /completed tool calls but returned no explicit value/u)
    assert.match(result.body ?? '', /echo \(success\):[\s\S]*\{"value":"completed"\}/u)
    assert.doesNotMatch(result.body ?? '', /undefined/u)
  } finally {
    await executor.dispose()
  }
})

test('Code Mode does not append implicit-success text when execution fails after a successful tool call', async () => {
  const registry = createTestRegistry()
  const executor = new CodeModeExecutor(registry)
  const codeModeTool = createCodeModeTool(executor, registry)

  try {
    type ExecutableTestTool = {
      execute?: (input: unknown, options: ToolExecutionOptions<unknown>) => Promise<unknown>
    }
    const execute = (codeModeTool as unknown as ExecutableTestTool).execute
    assert.equal(typeof execute, 'function')

    const result = await execute?.(
      { source: "await tools.echo({ value: 'completed' }); const values = [1]; return values.notAvailable" },
      {
        context: {},
        messages: [],
        toolCallId: 'test-code-mode-error-after-successful-tool-call',
      },
    ) as { body?: string; status?: string }

    assert.equal(result.status, 'error')
    assert.match(result.body ?? '', /not available in Tidecode Code Mode/u)
    assert.doesNotMatch(result.body ?? '', /completed tool calls but returned no explicit value/u)
  } finally {
    await executor.dispose()
  }
})

test('Code Mode renders a directly returned ToolResult with literal newlines', async () => {
  const entries = [{
    description: 'Returns multiline text.',
    execute: async () => ({
      body: 'first line\nsecond line',
      status: 'success' as const,
      summary: 'Returned multiline text.',
    }),
    inputSchema: { additionalProperties: false, properties: {}, type: 'object' as const },
    name: 'multiline',
    namespace: 'test',
  }]
  const registry: AgentToolRegistry = {
    entries,
    get(name) {
      return entries.find((entry) => entry.name === name)
    },
    search() {
      return entries.map((entry) => ({ ...entry, score: 1 }))
    },
  }
  const executor = new CodeModeExecutor(registry)
  const codeModeTool = createCodeModeTool(executor, registry)

  try {
    type ExecutableTestTool = {
      execute?: (input: unknown, options: ToolExecutionOptions<unknown>) => Promise<unknown>
    }
    const execute = (codeModeTool as unknown as ExecutableTestTool).execute
    assert.equal(typeof execute, 'function')
    const result = await execute?.(
      { source: 'return await tools.multiline({})' },
      { context: {}, messages: [], toolCallId: 'test-code-mode-multiline-result' },
    ) as { body?: string }

    assert.match(result.body ?? '', /first line\nsecond line/u)
    assert.doesNotMatch(result.body ?? '', /first line\\nsecond line/u)
    assert.doesNotMatch(result.body ?? '', /"body"/u)
  } finally {
    await executor.dispose()
  }
})

test('Code Mode explains non-serializable returned data instead of exposing a clone error', async () => {
  const executor = new CodeModeExecutor(createTestRegistry())

  try {
    const result = await executor.run('return { invalid: () => true }')

    assert.equal(result.status, 'error')
    assert.match(result.summary, /Code Mode result must contain plain objects only/u)
  } finally {
    await executor.dispose()
  }
})

test('Code Mode rejects failed tool promises and stops uncaught sequential execution', async () => {
  let secondToolWasInvoked = false
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
    {
      description: 'Record whether sequential execution continued.',
      execute: async () => {
        secondToolWasInvoked = true
        return { status: 'success' as const, summary: 'Second tool ran.' }
      },
      inputSchema: { type: 'object' as const },
      name: 'second_tool',
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
      'await tools.failing_tool({}); await tools.second_tool({}); return true',
      { allowedToolNames: ['failing_tool', 'second_tool'] },
    )

    assert.equal(result.status, 'error')
    assert.match(result.summary, /The test tool failed/u)
    assert.deepEqual(result.toolCalls.map((call) => call.name), ['failing_tool'])
    assert.equal(secondToolWasInvoked, false)
    assert.equal(result.output, undefined)
  } finally {
    await executor.dispose()
  }
})

test('Code Mode lets inspection programs recover explicitly from read failures', async () => {
  let successfulReadWasInvoked = false
  const entries = [
    {
      description: 'Read a test path.',
      execute: async (input: unknown) => {
        const requestedPath = (input as { path?: string }).path
        if (requestedPath === 'missing.ts') {
          return { status: 'error' as const, summary: 'Path not found: missing.ts' }
        }
        successfulReadWasInvoked = true
        return { body: 'found', status: 'success' as const, summary: 'Read known.ts' }
      },
      inputSchema: { type: 'object' as const },
      name: 'read',
      namespace: 'workspace',
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
      "let missing; try { await tools.read({ path: 'missing.ts' }) } catch (error) { missing = error.name } const known = await tools.read({ path: 'known.ts' }); return { missing, known: known.body }",
    )

    assert.equal(result.status, 'success')
    assert.equal(successfulReadWasInvoked, true)
    assert.deepEqual(result.output, { known: 'found', missing: 'ToolExecutionError' })
    assert.match(result.summary, /handling 1 failed tool call/u)
  } finally {
    await executor.dispose()
  }
})

test('Code Mode read rejects removed full_file and caps oversized limits', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-code-mode-read-limit-'))
  await fs.writeFile(
    path.join(workspaceRootPath, 'large.txt'),
    `${Array.from({ length: 600 }, (_, index) => `line-${index + 1}`).join('\n')}\n`,
    'utf8',
  )
  const registry = await createAgentToolRegistry({
    read: createReadTool({
      checkpointId: null,
      terminalExecutionMode: 'sandbox',
      workspaceRootPath,
    }),
  })
  const executor = new CodeModeExecutor(registry, undefined, { workspaceRootPath })

  try {
    const rejected = await registry.get('read')?.execute({
      full_file: true,
      path: 'large.txt',
    })
    const result = await executor.run(
      "const paged = await tools.read({ path: 'large.txt', limit: 1200 }); return { pagedEnd: paged.semantics.end_line, nextOffset: paged.semantics.next_offset }",
    )

    assert.equal(rejected?.status, 'error')
    assert.match(rejected?.summary ?? '', /additional properties/u)
    assert.equal(result.status, 'success')
    assert.deepEqual(result.output, { nextOffset: 501, pagedEnd: 500 })
  } finally {
    await executor.dispose()
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('Code Mode allows explicit recovery from a failed tool promise', async () => {
  const entries = [
    {
      description: 'Return a failed test result.',
      execute: async () => ({
        status: 'error' as const,
        summary: 'The recoverable tool failed.',
      }),
      inputSchema: { type: 'object' as const },
      name: 'failing_tool',
      namespace: 'test',
    },
    {
      description: 'Return a recovery result.',
      execute: async () => ({
        body: 'recovered',
        status: 'success' as const,
        summary: 'Recovery tool ran.',
      }),
      inputSchema: { type: 'object' as const },
      name: 'recovery_tool',
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
      "let failure = ''; try { await tools.failing_tool({}) } catch (error) { failure = error.message }; const recovery = await tools.recovery_tool({}); return { failure, recovery: recovery.body }",
      { allowedToolNames: ['failing_tool', 'recovery_tool'] },
    )

    assert.equal(result.status, 'success')
    assert.match(result.summary, /handling 1 failed tool call/u)
    assert.deepEqual(result.toolCalls.map((call) => call.name), ['failing_tool', 'recovery_tool'])
    assert.deepEqual(result.output, {
      failure: 'The recoverable tool failed.',
      recovery: 'recovered',
    })
  } finally {
    await executor.dispose()
  }
})

test('Code Mode does not reinterpret process metadata as a failed tool call', async () => {
  const entries = [
    {
      description: 'Return a successfully executed terminal result with a nonzero process exit.',
      execute: async () => ({
        body: 'state: completed\nstatus: completed\nexit_code: 17',
        semantics: {
          active: false,
          broker_session_id: 999,
          exit_code: 17,
          operation_id: 'internal-operation',
          state: 'completed',
          status: 'completed',
          wait_seconds: 1,
        },
        status: 'success' as const,
        summary: 'Started terminal session 43440',
      }),
      inputSchema: { type: 'object' as const },
      name: 'execute_terminal',
      namespace: 'terminal',
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
      "const terminal = await tools.execute_terminal({ command: 'npm test', wait_seconds: 1 }); return { toolStatus: terminal.status, processStatus: terminal.semantics.status, directExitCode: terminal.exit_code, exitCode: terminal.semantics.exit_code, semanticKeys: Object.keys(terminal.semantics).sort() }",
      { allowedToolNames: ['execute_terminal'] },
    )

    assert.equal(result.status, 'success')
    assert.equal(result.toolCalls[0]?.status, 'success')
    assert.deepEqual(result.output, {
      directExitCode: 17,
      exitCode: 17,
      processStatus: 'completed',
      semanticKeys: ['exit_code', 'state', 'status'],
      toolStatus: 'success',
    })
  } finally {
    await executor.dispose()
  }
})

test('Code Mode rejects unavailable tools before starting execution', async () => {
  const executor = new CodeModeExecutor(createTestRegistry())

  try {
    const result = await executor.run('return null', { allowedToolNames: ['missing_tool'] })

    assert.equal(result.status, 'error')
    assert.match(result.summary, /UnknownTool:.*unavailable/u)
    assert.equal(result.toolCalls.length, 0)
  } finally {
    await executor.dispose()
  }
})

test('Code Mode Full Access keeps the same owned language and blocks ambient host APIs', async () => {
  const executor = new CodeModeExecutor(createTestRegistry(), undefined, {
    terminalExecutionMode: 'full',
  })

  try {

    const result = await executor.run("return process.version")
    assert.equal(result.status, 'error')
    assert.match(result.summary, /ReferenceError: process is not defined/u)
  } finally {
    await executor.dispose()
  }
})

test('Code Mode structurally blocks direct Node and host APIs', async () => {
  const executor = new CodeModeExecutor(createTestRegistry(), undefined, {
    terminalExecutionMode: 'sandbox',
  })

  try {
    const blockedPrograms = [
      'return process.cwd()',
      'return global.process.version',
      "return (() => {}).constructor('return process')().cwd()",
      "return require('node:fs')",
      "return fs.readFileSync('package.json', 'utf8')",
      "return Buffer.from('ok').toString('base64')",
      "return await fetch('https://example.com')",
    ]

    for (const program of blockedPrograms) {
      const result = await executor.run(program)
      assert.equal(result.status, 'error')
      assert.match(result.summary, /ReferenceError|UnsupportedSyntax|TypeError/u)
      assert.equal(result.toolCalls.length, 0)
    }
  } finally {
    await executor.dispose()
  }
})

test('Code Mode sandbox blocks direct runtime access when execution reaches it', async () => {
  const executor = new CodeModeExecutor(createTestRegistry(), undefined, {
    terminalExecutionMode: 'sandbox',
  })

  try {
    const result = await executor.run(
      "await tools.echo({ value: 'would-run-first' }); return process.version",
      { allowedToolNames: ['echo'] },
    )

    assert.equal(result.status, 'error')
    assert.equal(result.toolCalls.length, 1)
    assert.match(result.summary, /ReferenceError: process is not defined/u)
  } finally {
    await executor.dispose()
  }
})

test('Code Mode allows host API words in comments and string data', async () => {
  const executor = new CodeModeExecutor(createTestRegistry(), undefined, {
    terminalExecutionMode: 'sandbox',
  })

  try {
    const program = [
      "// process.version and require('node:fs') are source text here",
      "const payload = \"process.version require('node:fs') fetch('https://example.com')\"",
      "const templateText = `process.version require('node:fs')`",
      "const response = await tools.echo({ payload, templateText })",
      "return response.body",
    ].join('\n')
    const result = await executor.run(program, { allowedToolNames: ['echo'] })

    assert.equal(result.status, 'success')
    assert.equal(result.toolCalls.length, 1)
  } finally {
    await executor.dispose()
  }
})

test('Code Mode rejects regex literals deterministically', async () => {
  const executor = new CodeModeExecutor(createTestRegistry(), undefined, {
    terminalExecutionMode: 'sandbox',
  })

  try {

    const result = await executor.run('const pattern = /Text/u; return pattern')
    assert.equal(result.status, 'error')
    assert.equal(result.toolCalls.length, 0)
    assert.match(result.summary, /UnsupportedSyntax: Regular expression literals are not supported/u)
  } finally {
    await executor.dispose()
  }
})

test('Code Mode sandbox blocks runtime access inside executable template expressions', async () => {
  const executor = new CodeModeExecutor(createTestRegistry(), undefined, {
    terminalExecutionMode: 'sandbox',
  })

  try {
    const result = await executor.run(
      "await tools.echo({ value: 'would-run-first' }); return `node: ${process.version}`",
      { allowedToolNames: ['echo'] },
    )

    assert.equal(result.status, 'error')
    assert.equal(result.toolCalls.length, 1)
    assert.match(result.summary, /ReferenceError: process is not defined/u)
  } finally {
    await executor.dispose()
  }
})

test('Code Mode rejects attempts to import the injected tools binding', async () => {
  const executor = new CodeModeExecutor(createTestRegistry(), undefined, {
    terminalExecutionMode: 'sandbox',
  })

  try {
    const result = await executor.run(
      `const { tools } = await import('./tools.js');
       const response = await tools.echo({ value: 'recovered' })
       return response.body`,
      { allowedToolNames: ['echo'] },
    )

    assert.equal(result.status, 'error')
    assert.equal(result.toolCalls.length, 0)
    assert.match(result.summary, /UnsupportedSyntax/u)
  } finally {
    await executor.dispose()
  }
})

test('Code Mode tool-only runtime blocks dynamic module loading', async () => {
  const executor = new CodeModeExecutor(createTestRegistry(), undefined, {
    terminalExecutionMode: 'sandbox',
  })

  try {
    for (const source of [
      "return await import('node:process')",
      "const { tools, extra } = await import('./tools.js'); return extra",
    ]) {
      const result = await executor.run(source)

      assert.equal(result.status, 'error')
      assert.equal(result.toolCalls.length, 0)
      assert.match(result.error ?? '', /UnsupportedSyntax: Syntax 'ImportExpression'/u)
    }
  } finally {
    await executor.dispose()
  }
})

test('Code Mode contract tells every provider that tools is injected', () => {
  assert.match(CODE_MODE_EXECUTION_CONTRACT, /The `tools` binding is injected/u)
  assert.match(CODE_MODE_EXECUTION_CONTRACT, /Never import, require, redeclare, or initialize `tools`/u)
})

test('Code Mode allows host-related words in filenames, URLs, and comments', async () => {
  const executor = new CodeModeExecutor(createTestRegistry())

  try {
    const result = await executor.run(
      `// fs and process are allowed as data here
       const filename = 'src/types/electron.d.ts'
       const url = 'https://example.com/module'
       const response = await tools.echo({ filename, url })
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
    assert.match(result.summary, /ParseError: Unexpected token/u)
    assert.doesNotMatch(result.summary, /forbidden runtime API: electron/iu)
  } finally {
    await executor.dispose()
  }
})

test('Code Mode reports generated syntax errors before executing tools', async () => {
  const executor = new CodeModeExecutor(createTestRegistry())

  try {
    const result = await executor.run(
      `const replacements = [\n  ['target', 'replacement')\n]\nreturn replacements`,
    )

    assert.equal(result.status, 'error')
    assert.equal(result.toolCalls.length, 0)
    assert.match(result.summary, /ParseError: Unexpected token/u)
    assert.match(result.summary, /line 2/u)
  } finally {
    await executor.dispose()
  }
})

test('Code Mode rejects malformed nested quote delimiters instead of repairing source', async () => {
  const entries = [{
    description: 'Capture edit input.',
    execute: async (input: unknown) => ({
      body: JSON.stringify(input),
      status: 'success' as const,
      summary: 'Captured edit input.',
    }),
    inputSchema: { type: 'object' as const },
    name: 'edit',
    namespace: 'filesystem',
  }]
  const registry: AgentToolRegistry = {
    entries,
    get(name) {
      return entries.find((entry) => entry.name === name)
    },
    search() {
      return entries.map((entry) => ({ ...entry, score: 1 }))
    },
  }
  const executor = new CodeModeExecutor(registry)
  const cases = [
    {
      expected: {
        edits: [{
          replacementContent: 'const label = `new ${name}`',
          targetContent: 'const label = `old ${name}`',
        }],
        path: 'value.ts',
      },
      program: [
        "return await tools.edit({ path: 'value.ts', edits: [{",
        '  targetContent: `const label = `old ${name}``,',
        '  replacementContent: `const label = `new ${name}``,',
        '}] })',
      ].join('\n'),
    },
    {
      expected: {
        edits: [{ replacementContent: "const label = 'new'", targetContent: "const label = 'old'" }],
        path: 'value.ts',
      },
      program: [
        "return await tools.edit({ path: 'value.ts', edits: [{",
        "  targetContent: 'const label = 'old'',",
        "  replacementContent: 'const label = 'new'',",
        '}] })',
      ].join('\n'),
    },
    {
      expected: {
        edits: [{ replacementContent: 'const label = "new"', targetContent: 'const label = "old"' }],
        path: 'value.ts',
      },
      program: [
        "return await tools.edit({ path: 'value.ts', edits: [{",
        '  targetContent: "const label = "old"",',
        '  replacementContent: "const label = "new"",',
        '}] })',
      ].join('\n'),
    },
  ]

  try {
    for (const testCase of cases) {
      const result = await executor.run(testCase.program, { allowedToolNames: ['edit'] })
      assert.equal(result.status, 'error')
      assert.equal(result.toolCalls.length, 0)
      assert.match(result.summary, /ParseError|UnsupportedSyntax/u)
    }
  } finally {
    await executor.dispose()
  }
})

test('Code Mode rejects malformed patch-array source before running the patch tool', async () => {
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
      "  \"+const newline = '\\n'\"",
      "  '*** End Patch'",
      ']',
      'return await tools.patch({ patch })',
    ].join('\n')
    const result = await executor.run(malformedPatchProgram)

    assert.equal(result.status, 'error')
    assert.equal(result.toolCalls.length, 0)
    assert.match(result.summary, /ParseError|UnsupportedSyntax/u)
  } finally {
    await executor.dispose()
  }
})

test('Code Mode rejects Python-style triple quotes', async () => {
  const executor = new CodeModeExecutor(createTestRegistry())

  try {
    const tripleQuoteProgram = 'const snippet = """<div>hello</div>"""; return { ok: true, text: snippet };'
    const result = await executor.run(tripleQuoteProgram)

    assert.equal(result.status, 'error')
    assert.match(result.summary, /ParseError|UnsupportedSyntax/u)
  } finally {
    await executor.dispose()
  }
})

test('Code Mode rejects triple-quote variants consistently', async () => {
  const executor = new CodeModeExecutor(createTestRegistry())
  const doubleTriple = '"'.repeat(3)
  const singleTriple = "'".repeat(3)
  const cases = [
    {
      expected: `alpha ${singleTriple}beta${singleTriple} gamma`,
      program: `const snippet = ${doubleTriple}alpha ${singleTriple}beta${singleTriple} gamma${doubleTriple}; return snippet`,
    },
    {
      expected: `alpha ${doubleTriple}beta${doubleTriple} gamma`,
      program: `const snippet = ${singleTriple}alpha ${doubleTriple}beta${doubleTriple} gamma${singleTriple}; return snippet`,
    },
    {
      expected: { first: 'one', second: 'two' },
      program: `const first = ${doubleTriple}one${doubleTriple}; const second = ${singleTriple}two${singleTriple}; return { first, second }`,
    },
  ]

  try {
    for (const testCase of cases) {
      const result = await executor.run(testCase.program)
      assert.equal(result.status, 'error')
      assert.match(result.summary, /ParseError|UnsupportedSyntax/u)
    }
  } finally {
    await executor.dispose()
  }
})

test('Code Mode rejects triple-quoted TSX source instead of rewriting it', async () => {
  const executor = new CodeModeExecutor(createTestRegistry())
  const tripleQuote = '"'.repeat(3)
  const escapedQuote = '\\' + '"'
  const tsx = [
    `import React from ${escapedQuote}react${escapedQuote}`,
    `const label = \`card-\${open ? ${escapedQuote}open${escapedQuote} : ${escapedQuote}closed${escapedQuote}}\``,
    'const matcher = /\\w+/',
    `return <div className=${escapedQuote}card${escapedQuote}>Hello</div>`,
  ].join('\n')
  const intentional = 'const message = "He said \\"hello\\"";'

  try {
    const repairedResult = await executor.run(
      `const snippet = ${tripleQuote}${tsx}${tripleQuote}; return snippet`,
    )
    assert.equal(repairedResult.status, 'error')
    assert.match(repairedResult.summary, /ParseError|UnsupportedSyntax/u)

    const preservedResult = await executor.run(
      `const snippet = ${tripleQuote}${intentional}${tripleQuote}; return snippet`,
    )
    assert.equal(preservedResult.status, 'error')
    assert.match(preservedResult.summary, /ParseError|UnsupportedSyntax/u)
  } finally {
    await executor.dispose()
  }
})

test('Code Mode rejects malformed nested template delimiters', async () => {
  const executor = new CodeModeExecutor(createTestRegistry())

  try {
    const nestedProgram = 'const payload = { content: `const val = `${x}` ` }; return { ok: true, val: payload.content };'
    const result = await executor.run(nestedProgram)

    assert.equal(result.status, 'error')
    assert.match(result.summary, /ParseError|UnsupportedSyntax/u)
  } finally {
    await executor.dispose()
  }
})

test('Code Mode rejects malformed quoted terminal commands before tool execution', async () => {
  const executor = new CodeModeExecutor(createTerminalTestRegistry())
  const expectedBindingCommand = "$payload = @{ quote = ''a b''; slash = ''C:\\temp\\x''; unicode = ''✓ 漢字 🚀''; delimiters = ''{}[],:; <>&'' }"
  const escapedBindingCommand = expectedBindingCommand.replaceAll('\\', '\\\\')
  const expectedFieldCommand = "Write-Output ''quoted''"
  const cases = [
    {
      expected: { command: expectedBindingCommand, cwd: '.', wait_seconds: 10 },
      program: "const cmd = '" + escapedBindingCommand + "';\nreturn await tools.execute_terminal({ command: cmd, cwd: '.', wait_seconds: 10 })",
    },
    {
      expected: { command: expectedFieldCommand, cwd: '.' },
      program: "return await tools.execute_terminal({ command: '" + expectedFieldCommand + "', cwd: '.' })",
    },
  ]

  try {
    for (const testCase of cases) {
      const result = await executor.run(testCase.program)
      assert.equal(result.status, 'error')
      assert.equal(result.toolCalls.length, 0)
      assert.match(result.summary, /ParseError|UnsupportedSyntax/u)
    }
  } finally {
    await executor.dispose()
  }
})

test('Code Mode exposes terminal session_id directly as well as in semantics', async () => {
  const executor = new CodeModeExecutor(createTerminalTestRegistry())

  try {
    const result = await executor.run([
      "const started = await tools.execute_terminal({ command: 'long-running' })",
      'return { direct: started.session_id, nested: started.semantics.session_id }',
    ].join('\n'))

    assert.equal(result.status, 'success')
    assert.deepEqual(result.output, { direct: 43440, nested: 43440 })
  } finally {
    await executor.dispose()
  }
})

test('Code Mode rejects malformed multiline Markdown template source', async () => {
  const executor = new CodeModeExecutor(createTestRegistry())
  const markdown = "# Stress report\nUse `inline code` and ${literal} as literal text."
  const malformedProgram = 'return await tools.echo({ content: `' + markdown + '` })'

  try {
    const result = await executor.run(malformedProgram)
    assert.equal(result.status, 'error')
    assert.equal(result.toolCalls.length, 0)
    assert.match(result.summary, /ParseError|UnsupportedSyntax/u)
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

test('the registry omits unsupported false properties while preserving supported false values', async () => {
  let receivedInput: unknown
  const registry = await createAgentToolRegistry({
    configurable: tool({
      description: 'Accepts a strict nested configuration.',
      inputSchema: jsonSchema({
        additionalProperties: false,
        properties: {
          enabled: { type: 'boolean' },
          options: {
            additionalProperties: false,
            properties: { mode: { type: 'string' } },
            required: ['mode'],
            type: 'object',
          },
        },
        required: ['enabled', 'options'],
        type: 'object',
      }),
      execute: async (input) => {
        receivedInput = input
        return { status: 'success' as const, summary: 'configured' }
      },
    }),
  })

  const result = await registry.get('configurable')?.execute({
    enabled: false,
    ignoredFlag: false,
    options: { mode: 'safe', replaceAll: false },
  })

  assert.equal(result?.status, 'success')
  assert.deepEqual(receivedInput, {
    enabled: false,
    options: { mode: 'safe' },
  })
})

test('the registry still rejects unsupported truthy properties', async () => {
  let wasInvoked = false
  const registry = await createAgentToolRegistry({
    configurable: tool({
      description: 'Accepts a strict nested configuration.',
      inputSchema: jsonSchema({
        additionalProperties: false,
        properties: {
          options: {
            additionalProperties: false,
            properties: { mode: { type: 'string' } },
            required: ['mode'],
            type: 'object',
          },
        },
        required: ['options'],
        type: 'object',
      }),
      execute: async () => {
        wasInvoked = true
        return { status: 'success' as const, summary: 'configured' }
      },
    }),
  })

  const result = await registry.get('configurable')?.execute({
    options: { mode: 'safe', replaceAll: true },
  })

  assert.equal(wasInvoked, false)
  assert.equal(result?.status, 'error')
  assert.match(result?.summary ?? '', /additional properties/u)
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

test('Code Mode receives bounded tool output while nested user-facing results keep the full body', async () => {
  const fullBody = Array.from(
    { length: 5_000 },
    (_value, index) => `output line ${index} ${'x'.repeat(60)}`,
  ).join('\n')
  const registry = await createAgentToolRegistry({
    noisy: tool({
      description: 'Returns a deliberately large result.',
      inputSchema: jsonSchema({ additionalProperties: false, properties: {}, type: 'object' }),
      execute: async () => ({
        body: fullBody,
        semantics: { output_id: 'noisy-existing-output' },
        status: 'success' as const,
        summary: 'Returned noisy output.',
      }),
    }),
  })
  const executor = new CodeModeExecutor(registry)

  try {
    const result = await executor.run([
      'const noisy = await tools.noisy({})',
      'return { body: noisy.body, displayBody: noisy.displayBody ?? null, outputId: noisy.semantics.output_id }',
    ].join('\n'))

    assert.equal(result.status, 'success')
    assert.equal(result.toolCalls.length, 1)
    assert.equal(result.toolCalls[0]?.body, fullBody)
    const output = result.output as { body: string; displayBody: unknown; outputId: string }
    assert.ok(Buffer.byteLength(output.body, 'utf8') < 40_000)
    assert.match(output.body, /output line 0 /u)
    assert.match(output.body, /output line 4999 /u)
    assert.match(output.body, /read_tool_output/u)
    assert.equal(output.displayBody, null)
    assert.equal(output.outputId, 'noisy-existing-output')
  } finally {
    await executor.dispose()
  }
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

test('Code Mode timeout aborts an in-flight host tool before returning', async () => {
  let observedAbort = false
  const entries = [{
    description: 'Wait until the execution is cancelled.',
    execute: async (_input: unknown, options?: { abortSignal?: AbortSignal }) => {
      await new Promise<void>((resolve) => {
        const signal = options?.abortSignal
        if (signal?.aborted) {
          observedAbort = true
          resolve()
          return
        }
        signal?.addEventListener('abort', () => {
          observedAbort = true
          resolve()
        }, { once: true })
      })
      return { status: 'success' as const, summary: 'Observed cancellation.' }
    },
    inputSchema: { type: 'object' as const },
    name: 'wait_for_abort',
    namespace: 'test',
  }]
  const registry: AgentToolRegistry = {
    entries,
    get(name) {
      return entries.find((entry) => entry.name === name)
    },
    search() {
      return entries.map((entry) => ({ ...entry, score: 1 }))
    },
  }
  const executor = new CodeModeExecutor(registry)

  try {
    const result = await executor.run('return await tools.wait_for_abort({})', {
      allowedToolNames: ['wait_for_abort'],
      limits: { timeoutMs: 2_000 },
    })

    assert.equal(result.status, 'error')
    assert.equal(observedAbort, true)
    assert.match(result.summary, /timeout/u)
  } finally {
    await executor.dispose()
  }
})

test('Code Mode forwards caller cancellation to an in-flight host tool', async () => {
  let observedAbort = false
  let markStarted: (() => void) | undefined
  const started = new Promise<void>((resolve) => { markStarted = resolve })
  const entries = [{
    description: 'Wait until the caller cancels the execution.',
    execute: async (_input: unknown, options?: { abortSignal?: AbortSignal }) => {
      markStarted?.()
      await new Promise<void>((resolve) => {
        const signal = options?.abortSignal
        if (signal?.aborted) {
          observedAbort = true
          resolve()
          return
        }
        signal?.addEventListener('abort', () => {
          observedAbort = true
          resolve()
        }, { once: true })
      })
      return { status: 'success' as const, summary: 'Observed cancellation.' }
    },
    inputSchema: { type: 'object' as const },
    name: 'wait_for_abort',
    namespace: 'test',
  }]
  const registry: AgentToolRegistry = {
    entries,
    get(name) {
      return entries.find((entry) => entry.name === name)
    },
    search() {
      return entries.map((entry) => ({ ...entry, score: 1 }))
    },
  }
  const executor = new CodeModeExecutor(registry)
  const controller = new AbortController()

  try {
    const runPromise = executor.run('return await tools.wait_for_abort({})', {
      abortSignal: controller.signal,
      allowedToolNames: ['wait_for_abort'],
      limits: { timeoutMs: 1_000 },
    })
    await started
    controller.abort()
    const result = await runPromise

    assert.equal(result.status, 'aborted')
    assert.equal(observedAbort, true)
  } finally {
    await executor.dispose()
  }
})

test('Code Mode capability search runs inside Code Mode while local tools remain preloaded', async () => {
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

    assert.deepEqual(Object.keys(bundle.tools).sort(), ['apply_patch', 'code_mode', 'write'])
    assert.equal(bundle.registry.get('tool_search'), undefined)
    assert.ok(bundle.nativeTools.edit)
    const codeModeSchema = await asSchema((bundle.tools.code_mode as { inputSchema: unknown }).inputSchema).jsonSchema as {
      properties?: Record<string, unknown>
    }
    assert.deepEqual(codeModeSchema.required, ['source'])
    assert.ok(codeModeSchema.properties && 'source' in codeModeSchema.properties)
    assert.equal(codeModeSchema.properties && 'code' in codeModeSchema.properties, false)
    assert.ok(codeModeSchema.properties && 'payloads' in codeModeSchema.properties)
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
      /Await tool calls before reading their results/u,
    )
    assert.match(
      ((bundle.tools.code_mode as { description?: string }).description ?? ''),
      /Path rule: every supplied path argument and every patch file header is one exact workspace-relative file or directory/u,
    )
    assert.match(
      ((bundle.tools.code_mode as { description?: string }).description ?? ''),
      /Never invent filenames or index files/u,
    )
    assert.match(
      ((bundle.tools.code_mode as { description?: string }).description ?? ''),
      /discover it with list, glob, or grep before reading or patching it/u,
    )
    assert.match(
      ((bundle.tools.code_mode as { description?: string }).description ?? ''),
      /omitted path where the schema permits omission, an empty string, or `\.` refers to the bound workspace root/u,
    )
    assert.match(
      ((bundle.tools.code_mode as { description?: string }).description ?? ''),
      /offset\?: number \(>= 1\)/u,
    )
    assert.match(
      ((bundle.tools.code_mode as { description?: string }).description ?? ''),
      /tools\.\$codemode\.search/u,
    )
    const codeModeDescription = (bundle.tools.code_mode as { description?: string }).description ?? ''
    assert.ok(codeModeDescription.includes(
      'AI-completed main work stops at `for-review`, which completes direct subtasks. Never directly target `done`',
    ))
    assert.ok(codeModeDescription.includes(
      'Set Owner per task: `Human` for user-originated work, `Agent` for work you introduce autonomously; do not blindly inherit parent ownership, and preserve explicit owner names.',
    ))
    assert.ok(codeModeDescription.includes(
      'action: "read_board" | "read_card" | "create_card" | "create_task_with_subtasks" | "update_card" | "move_card" | "reorder_card" | "delete_card"',
    ))
    assert.ok(codeModeDescription.includes(
      'acceptanceCriteria?: Array<{ text: string; completed?: boolean; id?: string }>',
    ))
    const kanbanEntry = bundle.registry.get('kanban_board')
    assert.ok(kanbanEntry)
    const kanbanActionSchema = (kanbanEntry.inputSchema.properties as Record<string, { enum?: unknown[] }> | undefined)?.action
    assert.deepEqual(kanbanActionSchema?.enum, [
      'read_board',
      'read_card',
      'create_card',
      'create_task_with_subtasks',
      'update_card',
      'move_card',
      'reorder_card',
      'delete_card',
    ])
    const invalidKanbanResult = await invoke(bundle.nativeTools.kanban_board, { action: 'list' }) as {
      status?: string
      summary?: string
    }
    assert.equal(invalidKanbanResult.status, 'error')
    assert.match(
      invalidKanbanResult.summary ?? '',
      /Unknown action: list\. Valid actions: read_board, read_card, create_card, create_task_with_subtasks, update_card, move_card, reorder_card, delete_card\./u,
    )
    assert.equal(codeModeDescription.split(CODE_MODE_EXECUTION_CONTRACT).length - 1, 1)
    assert.match(codeModeDescription, /executes a Tidecode-owned JavaScript-like orchestration language/u)
    assert.match(codeModeDescription, /Choose the purpose-built inner API for the scenario/u)
    assert.match(codeModeDescription, /structured outer input with `source` plus optional opaque `payloads`/u)
    assert.match(codeModeDescription, /Payload text is inert data and is never parsed as Code Mode source/u)
    assert.match(codeModeDescription, /Direct model-facing `apply_patch`: prefer this for a standalone targeted patch/u)
    assert.doesNotMatch(codeModeDescription, /tools\.apply_patch/u)
    assert.match(codeModeDescription, /tools\.edit/u)
    assert.match(codeModeDescription, /`tools\.execute_terminal`: run an actual command\/process/u)
    assert.match(codeModeDescription, /Never use shell, PowerShell, Python, or Node just to read, search, edit, or write workspace files/u)
    assert.doesNotMatch(codeModeDescription, /Tool-only runtime: direct Node\.js and host access is blocked/u)
    assert.match(codeModeDescription, /Sandbox keeps host authority restricted/u)
    assert.match(codeModeDescription, /Node\/process globals.*not part of the Code Mode language/u)
    assert.match(codeModeDescription, /session_id.*directly/u)
    assert.match(codeModeDescription, /Imports, dynamic imports, require.*not part of the Code Mode language/u)

    const codeResult = await invoke(bundle.tools.code_mode, {
      source: "const search = await tools.$codemode.search({ query: 'read', limit: 5 }); const file = await tools.read({ path: 'package.json' }); const root = await tools.read({ path: '' }); return { hasVersion: file.body.includes('1.2.3'), rootPath: root.subject?.path, discoveredRead: search.items.some((item) => item.path === 'tools.read') }",
    }) as { body?: string }
    assert.match(codeResult.body ?? '', /"hasVersion": true/u)
    assert.match(codeResult.body ?? '', /"rootPath": "\."/u)
    assert.match(codeResult.body ?? '', /"discoveredRead": true/u)

    const invalidEditResult = await invoke(bundle.tools.code_mode, {
      source: "return await tools.edit({ path: 'package.json', edits: [] })",
    }) as { semantics?: { tool_call_count?: number }; status?: string }
    assert.equal(invalidEditResult.status, 'error')
    assert.equal(invalidEditResult.semantics?.tool_call_count, 1)
  } finally {
    await codeModeExecutor?.dispose()
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('every provider exposes the same TideCode Code Mode description', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-code-mode-description-parity-'))
  const providerIds = ['openai', 'codex', 'anthropic', 'google', 'mistral', 'deepseek', 'custom:test'] as const
  const descriptions: string[] = []

  try {
    for (const providerId of providerIds) {
      const bundle = await createAgentToolBundle(
        { workspaceRootPath },
        { chatMode: 'agent', orchestrationMode: 'code_mode', providerId },
      )
      const codeModeTool = bundle.tools.code_mode as unknown as {
        args?: { description?: string }
        description?: string
      }

      try {
        const description = codeModeTool.args?.description ?? codeModeTool.description ?? ''
        assert.equal(description, buildCodeModeDescription(bundle.registry))
        descriptions.push(description)
      } finally {
        await bundle.codeModeExecutor?.dispose()
      }
    }

    assert.ok(descriptions[0]?.length)
    assert.deepEqual(new Set(descriptions).size, 1)
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('every provider uses the same structured Code Mode source and payload schema', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-code-mode-structured-'))

  try {
    await fs.writeFile(path.join(workspaceRootPath, 'value.txt'), 'structured\n', 'utf8')

    for (const providerId of ['openai', 'codex', 'anthropic', 'google', 'mistral', 'deepseek', 'custom:test'] as const) {
      const bundle = await createAgentToolBundle(
        { workspaceRootPath },
        { chatMode: 'agent', orchestrationMode: 'code_mode', providerId },
      )
      const codeModeTool = bundle.tools.code_mode as {
        execute?: (input: unknown, options: ToolExecutionOptions<unknown>) => Promise<unknown>
        inputSchema: unknown
        type?: string
      }

      try {
        assert.notEqual(codeModeTool.type, 'provider')
        const inputSchema = await asSchema(codeModeTool.inputSchema).jsonSchema as {
          properties?: Record<string, unknown>
          required?: string[]
          type?: string
        }
        assert.equal(inputSchema.type, 'object')
        assert.deepEqual(inputSchema.required, ['source'])
        assert.ok(inputSchema.properties && 'source' in inputSchema.properties)
        assert.ok(inputSchema.properties && 'payloads' in inputSchema.properties)

        const result = await codeModeTool.execute?.(
          {
            payloads: { expected: 'structured' },
            source: "const value = await tools.read({ path: 'value.txt' }); return { file: value.body.trim(), payload: payloads.expected }",
          },
          { context: {}, messages: [], toolCallId: 'structured-' + providerId },
        ) as { body?: string; status?: string }
        assert.equal(result.status, 'success')
        assert.ok((result.body ?? '').includes('"file": "structured"'))
        assert.ok((result.body ?? '').includes('"payload": "structured"'))
      } finally {
        await bundle.codeModeExecutor?.dispose()
      }
    }
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('Code Mode payloads preserve arbitrary nested text and are read-only', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-code-mode-payloads-'))
  const fence = String.fromCharCode(96).repeat(3)
  const payload = [
    fence + 'tsx',
    'const view = `hello ${name}`',
    String.raw`const rx = /a\\b\\s+/g`,
    String.raw`const path = "C:\\Users\\Admin\\file.ts"`,
    fence,
  ].join('\\n')

  try {
    const bundle = await createAgentToolBundle(
      { workspaceRootPath },
      { chatMode: 'agent', orchestrationMode: 'code_mode', providerId: 'openai' },
    )
    const codeModeTool = bundle.tools.code_mode as {
      execute?: (input: unknown, options: ToolExecutionOptions<unknown>) => Promise<unknown>
    }
    try {
      const result = await codeModeTool.execute?.(
        { payloads: { source: payload }, source: 'return payloads.source' },
        { context: {}, messages: [], toolCallId: 'payload-preserve' },
      ) as { body?: string; status?: string }
      assert.equal(result.status, 'success')
      assert.ok((result.body ?? '').includes(fence + 'tsx'))
      assert.ok((result.body ?? '').includes('const view = `hello ${name}`'))
      assert.ok((result.body ?? '').includes(String.raw`const rx = /a\\b\\s+/g`))
      assert.ok((result.body ?? '').includes(String.raw`C:\\Users\\Admin\\file.ts`))

      const mutation = await codeModeTool.execute?.(
        { payloads: { source: payload }, source: "payloads.source = 'changed'; return payloads.source" },
        { context: {}, messages: [], toolCallId: 'payload-readonly' },
      ) as { body?: string; semantics?: { tool_call_count?: number }; status?: string }
      assert.equal(mutation.status, 'error')
      assert.match(mutation.body ?? '', /read-only/u)
      assert.equal(mutation.semantics?.tool_call_count, 0)
    } finally {
      await bundle.codeModeExecutor?.dispose()
    }
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('Code Mode rejects oversized payloads before executing tools', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-code-mode-payload-limit-'))
  try {
    const bundle = await createAgentToolBundle(
      { workspaceRootPath },
      { chatMode: 'agent', orchestrationMode: 'code_mode' },
    )
    const codeModeTool = bundle.tools.code_mode as {
      execute?: (input: unknown, options: ToolExecutionOptions<unknown>) => Promise<unknown>
    }
    try {
      const result = await codeModeTool.execute?.(
        { payloads: { huge: 'x'.repeat(2_000_001) }, source: 'return await tools.list({})' },
        { context: {}, messages: [], toolCallId: 'payload-limit' },
      ) as { body?: string; semantics?: { tool_call_count?: number }; status?: string }
      assert.equal(result.status, 'error')
      assert.match(result.body ?? '', /payloads exceeded the 2000000-byte limit/u)
      assert.equal(result.semantics?.tool_call_count, 0)
    } finally {
      await bundle.codeModeExecutor?.dispose()
    }
  } finally {
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('Full Access keeps provider-facing Code Mode on the same confined language', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-code-mode-full-terminal-'))
  let codeModeExecutor: CodeModeExecutor | null = null

  try {
    const bundle = await createAgentToolBundle(
      { terminalExecutionMode: 'full', workspaceRootPath },
      { chatMode: 'agent', orchestrationMode: 'code_mode' },
    )
    codeModeExecutor = bundle.codeModeExecutor
    const codeModeTool = bundle.tools.code_mode as {
      execute?: (input: unknown, options: ToolExecutionOptions<unknown>) => Promise<unknown>
    }
    assert.equal(typeof codeModeTool.execute, 'function')

    const result = await codeModeTool.execute?.(
      {
        source: `import http from 'node:http'
const path = await import('node:path')
return { file: path.basename('/tmp/example.txt'), node: typeof process.version === 'string', request: typeof http.request === 'function' }`,
      },
      { context: {}, messages: [], toolCallId: 'full-terminal-code-mode' },
    ) as { body?: string; status?: string }

    assert.equal(result.status, 'error')
    assert.match(result.body ?? '', /ParseError|UnsupportedSyntax/u)
  } finally {
    await codeModeExecutor?.dispose()
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('Plan Mode keeps Code Mode on the same confined language when terminal Full Access is selected', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-code-mode-plan-full-'))
  const bypassPath = path.join(workspaceRootPath, 'plan-mode-bypass.txt')
  let codeModeExecutor: CodeModeExecutor | null = null

  try {
    const bundle = await createAgentToolBundle(
      { terminalExecutionMode: 'full', workspaceRootPath },
      { chatMode: 'plan', orchestrationMode: 'code_mode' },
    )
    codeModeExecutor = bundle.codeModeExecutor
    const codeModeTool = bundle.tools.code_mode as {
      args?: { description?: string }
      description?: string
      execute?: (input: unknown, options: ToolExecutionOptions<unknown>) => Promise<unknown>
    }
    const description = codeModeTool.args?.description ?? codeModeTool.description ?? ''
    assert.match(description, /Tidecode-owned JavaScript-like orchestration language/u)
    assert.doesNotMatch(description, /Full Access is active for Agent Mode Code Mode/u)

    const result = await codeModeTool.execute?.(
      { source: "fs.writeFileSync('plan-mode-bypass.txt', 'blocked'); return 'mutated'" },
      { context: {}, messages: [], toolCallId: 'plan-full-code-mode' },
    ) as { body?: string; status?: string }

    assert.equal(result.status, 'error')
    assert.match(result.body ?? '', /ReferenceError: fs is not defined/u)
    await assert.rejects(fs.access(bypassPath))
  } finally {
    await codeModeExecutor?.dispose()
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('Plan Mode rejects unsupported syntax before any tool execution', async () => {
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-code-mode-plan-parse-'))
  let codeModeExecutor: CodeModeExecutor | null = null

  try {
    const bundle = await createAgentToolBundle(
      { terminalExecutionMode: 'full', workspaceRootPath },
      { chatMode: 'plan', orchestrationMode: 'code_mode' },
    )
    codeModeExecutor = bundle.codeModeExecutor
    const codeModeTool = bundle.tools.code_mode as {
      execute?: (input: unknown, options: ToolExecutionOptions<unknown>) => Promise<unknown>
    }
    const result = await codeModeTool.execute?.(
      { source: "with ({}) {}\nreturn await import('node:os');" },
      { context: {}, messages: [], toolCallId: 'plan-parse-code-mode' },
    ) as { semantics?: { tool_call_count?: number }; status?: string; body?: string }

    assert.equal(result.status, 'error')
    assert.equal(result.semantics?.tool_call_count, 0)
    assert.match(result.body ?? '', /UnsupportedSyntax: Syntax 'WithStatement'/u)
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
  const registry = await createAgentToolRegistry(mcpTools)
  const executor = new CodeModeExecutor(registry, registry.entries.map((entry) => entry.name))

  try {
    const result = await executor.run(
      `const search = await tools.$codemode.search({ query: 'connected project memory', namespace: 'mcp' })
       const discovered = search.items[0].path
       const memory = await tools.mcp.project_memory({ topic: 'architecture' })
       return { discovered, value: memory.body }`,
    )

    assert.equal(result.status, 'success')
    assert.deepEqual(result.output, {
      discovered: 'tools.mcp.project_memory',
      value: 'memory:architecture',
    })
    assert.deepEqual(result.toolCalls.map((call) => call.name), [
      'mcp_project_memory',
    ])
  } finally {
    await executor.dispose()
  }
})
