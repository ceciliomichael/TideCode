import assert from 'node:assert/strict'
import test from 'node:test'

import { CodeModeExecutor } from '../../electron/chat/shared/codeMode/executor'
import type { AgentToolRegistry } from '../../electron/chat/shared/tools/registry'

function createCaptureRegistry(): AgentToolRegistry {
  const entries = [{
    description: 'Capture the provided value.',
    execute: async (input: unknown) => ({
      body: JSON.stringify(input),
      status: 'success' as const,
      summary: 'Captured input.',
    }),
    inputSchema: { type: 'object' as const },
    name: 'capture',
    namespace: 'test',
  }]

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

test('Code Mode preserves long String.raw payload bindings with Markdown backticks', async () => {
  const executor = new CodeModeExecutor(createCaptureRegistry())
  const markdown = '# Plan\nUse `GetUserByID`; preserve ${literal} and C:\\temp\\route.\n'
  const malformedProgram = [
    'const content = String.raw\x60' + markdown + '\x60;',
    'return await tools.capture({ content });',
  ].join('\n')

  try {
    const result = await executor.run(malformedProgram, { allowedToolNames: ['capture'] })
    assert.equal(result.status, 'success')
    assert.equal(result.toolCalls.length, 1)
    assert.deepEqual(result.toolCalls[0]?.arguments, { content: markdown })
  } finally {
    await executor.dispose()
  }
})

test('Code Mode repairs arbitrary payload binding names used as explicit tool values', async () => {
  const executor = new CodeModeExecutor(createCaptureRegistry())
  const markdown = '# Plan\nPlace the adapter in the existing `backend` Go module as `backend/cmd/routegate-mcp`.\n'
  const malformedProgram = [
    'const plan = \x60' + markdown + '\x60;',
    'return await tools.capture({ content: plan });',
  ].join('\n')

  try {
    const result = await executor.run(malformedProgram, { allowedToolNames: ['capture'] })
    assert.equal(result.status, 'success')
    assert.equal(result.toolCalls.length, 1)
    assert.deepEqual(result.toolCalls[0]?.arguments, { content: markdown })
  } finally {
    await executor.dispose()
  }
})

test('Code Mode repairs a missing colon in a simple tool argument property', async () => {
  const executor = new CodeModeExecutor(createCaptureRegistry())

  try {
    const result = await executor.run(
      'return await tools.capture({ include "*.go", limit: 200 })',
      { allowedToolNames: ['capture'] },
    )
    assert.equal(result.status, 'success')
    assert.equal(result.toolCalls.length, 1)
    assert.deepEqual(result.toolCalls[0]?.arguments, { include: '*.go', limit: 200 })
  } finally {
    await executor.dispose()
  }
})

test('Code Mode does not guess structural repairs for truncated programs', async () => {
  const executor = new CodeModeExecutor(createCaptureRegistry())

  try {
    const result = await executor.run('return { value: [1, 2')
    assert.equal(result.status, 'error')
    assert.equal(result.toolCalls.length, 0)
    assert.match(result.summary, /invalid JavaScript/u)
  } finally {
    await executor.dispose()
  }
})

test('Code Mode sandbox allows host API words as harmless local identifiers', async () => {
  const executor = new CodeModeExecutor(createCaptureRegistry(), undefined, {
    terminalExecutionMode: 'sandbox',
  })

  try {
    const result = await executor.run(
      "const http = { status: 200 }; const module = { kind: 'local' }; const process = 'local'; return { http: http.status, module: module.kind, process }",
    )
    assert.equal(result.status, 'success')
    assert.deepEqual(result.output, { http: 200, module: 'local', process: 'local' })
  } finally {
    await executor.dispose()
  }
})

test('Code Mode sandbox rejects actual static module loading before tools run', async () => {
  const executor = new CodeModeExecutor(createCaptureRegistry(), undefined, {
    terminalExecutionMode: 'sandbox',
  })

  try {
    const result = await executor.run(
      "import http from 'node:http'\nreturn await tools.capture({ request: typeof http.request })",
      { allowedToolNames: ['capture'] },
    )
    assert.equal(result.status, 'error')
    assert.equal(result.toolCalls.length, 0)
    assert.match(result.summary, /sandbox runtime does not allow module loading \(node:http\)/u)
  } finally {
    await executor.dispose()
  }
})

test('Code Mode Full Access lowers normal static Node imports reliably', async () => {
  const executor = new CodeModeExecutor(createCaptureRegistry(), undefined, {
    terminalExecutionMode: 'full',
  })

  try {
    const result = await executor.run(
      `import http from 'node:http'
import {
  basename as base,
  dirname
} from 'node:path'
import * as os from 'node:os'
return {
  base: base('/tmp/example.txt'),
  dir: dirname('/tmp/example.txt'),
  platform: typeof os.platform(),
  request: typeof http.request,
}`,
    )
    assert.equal(result.status, 'success')
    assert.deepEqual(result.output, {
      base: 'example.txt',
      dir: '/tmp',
      platform: 'string',
      request: 'function',
    })
  } finally {
    await executor.dispose()
  }
})

test('Code Mode Full Access resolves installed package imports', async () => {
  const executor = new CodeModeExecutor(createCaptureRegistry(), undefined, {
    terminalExecutionMode: 'full',
  })

  try {
    const result = await executor.run(
      `import { z } from 'zod' // normal package import
return z.object({ value: z.string() }).parse({ value: 'ok' })`,
    )
    assert.equal(result.status, 'success')
    assert.deepEqual(result.output, { value: 'ok' })
  } finally {
    await executor.dispose()
  }
})
