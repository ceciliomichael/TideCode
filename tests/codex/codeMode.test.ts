import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { asSchema, jsonSchema, tool, type ToolExecutionOptions } from 'ai'
import { CodeModeExecutor } from '../../electron/chat/shared/codeMode/executor'
import { CODE_MODE_EXECUTION_CONTRACT } from '../../electron/chat/shared/codeMode/promptContract'
import { createAgentToolBundle } from '../../electron/chat/shared/tools'
import { createCodeModeTool, createToolSearchTool } from '../../electron/chat/shared/tools/metaTools'
import { createAgentToolRegistry, type AgentToolRegistry } from '../../electron/chat/shared/tools/registry'

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

test('Code Mode drains detached tool promise chains before completing', async () => {
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
      'tools.slow({ value: 1 }).then(() => tools.slow({ value: 2 })); return true',
      { allowedToolNames: ['slow'] },
    )

    assert.equal(result.status, 'success')
    assert.deepEqual(invoked, [1, 2])
    assert.equal(result.toolCalls.length, 2)
    assert.deepEqual(result.toolCalls.map((call) => call.arguments), [{ value: 1 }, { value: 2 }])
    assert.match(result.summary, /2 tool calls/u)
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
      { code: "tools.echo({ value: 'completed' })" },
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
      { code: 'return await tools.multiline({})' },
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
    assert.match(result.summary, /non-serializable data/u)
    assert.match(result.summary, /await every tools\.\* call/u)
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

    assert.equal(result.status, 'error')
    assert.match(result.summary, /1 failed tool call/u)
    assert.deepEqual(result.toolCalls.map((call) => call.name), ['failing_tool', 'recovery_tool'])
    assert.deepEqual(result.output, {
      failure: 'The recoverable tool failed.',
      recovery: 'recovered',
    })
  } finally {
    await executor.dispose()
  }
})

test('Code Mode marks semantic process failures as failed inner calls without hiding the result', async () => {
  const entries = [
    {
      description: 'Return a terminal result whose process exited unsuccessfully.',
      execute: async () => ({
        body: 'status: failed\nresult: failed',
        semantics: { state: 'completed', status: 'failed' },
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
      "const terminal = await tools.execute_terminal({ command: 'npm test', wait_seconds: 1 }); return { toolStatus: terminal.status, processStatus: terminal.semantics.status }",
      { allowedToolNames: ['execute_terminal'] },
    )

    assert.equal(result.status, 'error')
    assert.match(result.summary, /1 failed tool call/u)
    assert.equal(result.toolCalls[0]?.status, 'error')
    assert.deepEqual(result.output, {
      processStatus: 'failed',
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
    assert.match(result.summary, /not available/u)
    assert.equal(result.toolCalls.length, 0)
  } finally {
    await executor.dispose()
  }
})

test('Code Mode executes runtime APIs when requested', async () => {
  const executor = new CodeModeExecutor(createTestRegistry(), undefined, {
    terminalExecutionMode: 'full',
  })

  try {
    const result = await executor.run(
      "const path = require('node:path'); return { directFs: typeof fs.readFileSync === 'function', directHttp: typeof http.request === 'function', directWorker: typeof Worker === 'function', node: typeof process.versions.node === 'string', file: path.basename('/tmp/example.txt'), encoded: Buffer.from('ok').toString('base64') }",
    )

    assert.equal(result.status, 'success')
    assert.deepEqual(result.output, {
      encoded: 'b2s=',
      file: 'example.txt',
      directFs: true,
      directHttp: true,
      directWorker: true,
      node: true,
    })
  } finally {
    await executor.dispose()
  }
})

test('Code Mode tool-only runtime blocks direct Node and host APIs', async () => {
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
      assert.match(result.summary, /tool-only runtime blocked|Use the matching tools/u)
      assert.equal(result.toolCalls.length, 0)
    }
  } finally {
    await executor.dispose()
  }
})

test('Code Mode preflights blocked runtime access before any tool call can run', async () => {
  const executor = new CodeModeExecutor(createTestRegistry(), undefined, {
    terminalExecutionMode: 'sandbox',
  })

  try {
    const result = await executor.run(
      "await tools.echo({ value: 'would-run-first' }); return process.version",
      { allowedToolNames: ['echo'] },
    )

    assert.equal(result.status, 'error')
    assert.equal(result.toolCalls.length, 0)
    assert.match(result.summary, /blocked process before execution/u)
    assert.match(result.summary, /No tool ran/u)
  } finally {
    await executor.dispose()
  }
})

test('Code Mode preflight ignores blocked runtime names in non-executable tool data', async () => {
  const executor = new CodeModeExecutor(createTestRegistry(), undefined, {
    terminalExecutionMode: 'sandbox',
  })

  try {
    const program = [
      "// process.version and require('node:fs') are source text here",
      "const payload = \"process.version require('node:fs') fetch('https://example.com')\"",
      "const templateText = `process.version require('node:fs')`",
      "const pattern = /process\\.version|require\\('node:fs'\\)/u",
      "const response = await tools.echo({ payload, templateText, pattern: String(pattern) })",
      "return response.body",
    ].join('\n')
    const result = await executor.run(program, { allowedToolNames: ['echo'] })

    assert.equal(result.status, 'success')
    assert.equal(result.toolCalls.length, 1)
  } finally {
    await executor.dispose()
  }
})

test('Code Mode preflight still scans executable template expressions', async () => {
  const executor = new CodeModeExecutor(createTestRegistry(), undefined, {
    terminalExecutionMode: 'sandbox',
  })

  try {
    const result = await executor.run(
      "await tools.echo({ value: 'would-run-first' }); return `node: ${process.version}`",
      { allowedToolNames: ['echo'] },
    )

    assert.equal(result.status, 'error')
    assert.equal(result.toolCalls.length, 0)
    assert.match(result.summary, /blocked process before execution/u)
  } finally {
    await executor.dispose()
  }
})

test('Code Mode tool-only runtime blocks dynamic module loading', async () => {
  const executor = new CodeModeExecutor(createTestRegistry(), undefined, {
    terminalExecutionMode: 'sandbox',
  })

  try {
    const result = await executor.run("return await import('node:process')")

    assert.equal(result.status, 'error')
    assert.match(result.error ?? '', /tool-only runtime does not allow dynamic module loading/u)
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

test('Code Mode repairs nested quote delimiters in edit source payloads', async () => {
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
      assert.equal(result.status, 'success')
      assert.equal(result.toolCalls.length, 1)
      assert.deepEqual(result.toolCalls[0]?.arguments, testCase.expected)
    }
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

test('Code Mode repairs Python-style triple quotes in program syntax', async () => {
  const executor = new CodeModeExecutor(createTestRegistry())

  try {
    const tripleQuoteProgram = 'const snippet = """<div>hello</div>"""; return { ok: true, text: snippet };'
    const result = await executor.run(tripleQuoteProgram)

    assert.equal(result.status, 'success')
    assert.deepEqual(result.output, { ok: true, text: '<div>hello</div>' })
  } finally {
    await executor.dispose()
  }
})

test('Code Mode triple-quote repair preserves opposite delimiters and multiple strings', async () => {
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
      assert.equal(result.status, 'success')
      assert.deepEqual(result.output, testCase.expected)
    }
  } finally {
    await executor.dispose()
  }
})

test('Code Mode repairs unescaped inner backticks and template expressions in tool arguments', async () => {
  const executor = new CodeModeExecutor(createTestRegistry())

  try {
    const nestedProgram = 'const payload = { content: `const val = `${x}` ` }; return { ok: true, val: payload.content };'
    const result = await executor.run(nestedProgram)

    assert.equal(result.status, 'success')
    assert.deepEqual(result.output, { ok: true, val: 'const val = `${x}` ' })
  } finally {
    await executor.dispose()
  }
})

test('Code Mode repairs malformed quoted execute_terminal commands from generated programs', async () => {
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
      assert.equal(result.status, 'success')
      assert.equal(result.toolCalls.length, 1)
      assert.deepEqual(result.toolCalls[0]?.arguments, testCase.expected)
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

test('Code Mode repairs multiline Markdown content with nested backticks and template text', async () => {
  const executor = new CodeModeExecutor(createTestRegistry())
  const markdown = "# Stress report\nUse `inline code` and ${literal} as literal text."
  const malformedProgram = 'return await tools.echo({ content: `' + markdown + '` })'

  try {
    const result = await executor.run(malformedProgram)
    assert.equal(result.status, 'success')
    assert.equal(result.toolCalls.length, 1)
    assert.deepEqual(result.toolCalls[0]?.arguments, { content: markdown })
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
    const codeModeSchema = await asSchema((bundle.tools.code_mode as { inputSchema: unknown }).inputSchema).jsonSchema as {
      properties?: Record<string, unknown>
    }
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
      /Await every `tools\.\*` call/u,
    )
    assert.match(
      ((bundle.tools.code_mode as { description?: string }).description ?? ''),
      /Path rule: every supplied path argument is one exact workspace-relative file or directory/u,
    )
    assert.match(
      ((bundle.tools.code_mode as { description?: string }).description ?? ''),
      /Never invent filenames or index files/u,
    )
    assert.match(
      ((bundle.tools.code_mode as { description?: string }).description ?? ''),
      /discover it with list, glob, or grep before reading or editing it/u,
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
      /tools\.tool_search\(\{ limit\?: number/u,
    )
    const codeModeDescription = (bundle.tools.code_mode as { description?: string }).description ?? ''
    assert.equal(codeModeDescription.split(CODE_MODE_EXECUTION_CONTRACT).length - 1, 1)
    assert.match(codeModeDescription, /temporary asynchronous JavaScript program running in a tool-only worker/u)
    assert.match(codeModeDescription, /Choose the purpose-built inner API for the scenario/u)
    assert.match(codeModeDescription, /top-level code_mode payloads object/u)
    assert.match(codeModeDescription, /`tools\.edit`: make a targeted change to an existing text file/u)
    assert.match(codeModeDescription, /`tools\.execute_terminal`: run an actual command\/process/u)
    assert.match(codeModeDescription, /Never use shell, PowerShell, Python, or Node just to read, search, edit, or write workspace files/u)
    assert.doesNotMatch(codeModeDescription, /Tool-only runtime: direct Node\.js and host access is blocked/u)
    assert.match(codeModeDescription, /Unavailable host\/runtime APIs in Code Mode include/u)
    assert.match(codeModeDescription, /`fs` \/ `node:fs`/u)
    assert.match(codeModeDescription, /`child_process` \/ `node:child_process`/u)
    assert.match(codeModeDescription, /session_id.*directly/u)
    assert.match(codeModeDescription, /dynamic `import\(\)` are blocked/u)
    assert.match(codeModeDescription, /rejected before execution/u)
    assert.match(codeModeDescription, /non-executable string, comment, regex, and template-literal text/u)

    const codeResult = await invoke(bundle.tools.code_mode, {
      code: "const search = await tools.tool_search({ query: 'connected memory service', limit: 5 }); const file = await tools.read({ path: 'package.json' }); const root = await tools.read({ path: '' }); return { hasVersion: file.body.includes('1.2.3'), rootPath: root.subject?.path, searchStatus: search.status }",
    }) as { body?: string }
    assert.match(codeResult.body ?? '', /"hasVersion": true/u)
    assert.match(codeResult.body ?? '', /"rootPath": "\."/u)
    assert.match(codeResult.body ?? '', /"searchStatus": "success"/u)
  } finally {
    await codeModeExecutor?.dispose()
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('full terminal mode does not grant direct Node access inside provider-facing Code Mode', async () => {
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
      { code: 'return process.version' },
      { context: {}, messages: [], toolCallId: 'full-terminal-code-mode' },
    ) as { body?: string; status?: string }

    assert.equal(result.status, 'error')
    assert.match(result.body ?? '', /tool-only runtime blocked process/u)
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
