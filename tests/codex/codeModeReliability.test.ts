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

async function expectSourceFailure(source: string, terminalExecutionMode?: 'sandbox' | 'full') {
  const executor = new CodeModeExecutor(createCaptureRegistry(), undefined, terminalExecutionMode ? { terminalExecutionMode } : undefined)
  try {
    const result = await executor.run(source, { allowedToolNames: ['capture'] })
    assert.equal(result.status, 'error')
    assert.equal(result.toolCalls.length, 0)
    assert.match(result.summary, /ParseError|UnsupportedSyntax|ReferenceError/u)
    return result
  } finally {
    await executor.dispose()
  }
}

test('Code Mode rejects malformed String.raw payload source without rewriting it', async () => {
  const markdown = '# Plan\nUse `GetUserByID`; preserve ' + '$' + '{literal} and C:\\temp\\route.\n'
  const malformedProgram = [
    'const content = String.raw\x60' + markdown + '\x60;',
    'return await tools.capture({ content });',
  ].join('\n')

  await expectSourceFailure(malformedProgram)
})

test('Code Mode rejects malformed payload bindings instead of repairing arbitrary names', async () => {
  const markdown = '# Plan\nPlace the adapter in the existing `backend` module.\n'
  const malformedProgram = [
    'const plan = \x60' + markdown + '\x60;',
    'return await tools.capture({ content: plan });',
  ].join('\n')

  await expectSourceFailure(malformedProgram)
})

test('Code Mode rejects a missing colon in tool arguments instead of repairing source', async () => {
  await expectSourceFailure('return await tools.capture({ include "*.go", limit: 200 })')
})

test('Code Mode reports truncated programs as parse errors without structural guessing', async () => {
  const result = await expectSourceFailure('return { value: [1, 2')
  assert.match(result.summary, /ParseError/u)
})

test('Code Mode allows host API words as harmless local identifiers', async () => {
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

test('Code Mode sandbox rejects static module loading before tools run', async () => {
  const source = 'im' + "port http from 'node:http'\nreturn await tools.capture({ request: typeof http.request })"
  const result = await expectSourceFailure(source, 'sandbox')
  assert.match(result.summary, /ParseError|UnsupportedSyntax/u)
})

test('Code Mode rejects unsupported function-body syntax before tools run', async () => {
  const result = await expectSourceFailure('with ({}) {}\nreturn 1', 'sandbox')
  assert.match(result.summary, /UnsupportedSyntax: Syntax 'WithStatement'/u)
})

test('Code Mode Full Access keeps the same confined language for module loading', async () => {
  const staticImport = 'im' + "port http from 'node:http'; return typeof http.request"
  const dynamicImport = 'return await ' + 'im' + "port('node:path')"
  const requireSource = 'return ' + 'requ' + "ire('node:fs')"

  for (const source of [staticImport, dynamicImport, requireSource]) {
    await expectSourceFailure(source, 'full')
  }
})

test('Code Mode allows import-like text in comments, strings, and template text', async () => {
  const executor = new CodeModeExecutor(createCaptureRegistry(), undefined, {
    terminalExecutionMode: 'sandbox',
  })

  try {
    const importText = 'im' + "port('node:os')"
    const source = [
      '// ' + importText + ' is comment text',
      'const stringValue = ' + JSON.stringify(importText),
      'const templateValue = `' + importText + '`',
      'return { stringValue, templateValue }',
    ].join('\n')
    const result = await executor.run(source)
    assert.equal(result.status, 'success')
    assert.deepEqual(result.output, { stringValue: importText, templateValue: importText })
  } finally {
    await executor.dispose()
  }
})

test('Code Mode rejects dynamic imports in nested executable positions', async () => {
  const keyword = 'im' + 'port'
  const programs = [
    'async function load() { return await ' + keyword + "('node:os') } return typeof (await load()).platform",
    'const loaded = await ' + keyword + "('node:os'); return typeof loaded.platform",
  ]

  for (const source of programs) {
    const result = await expectSourceFailure(source, 'sandbox')
    assert.match(result.summary, /UnsupportedSyntax.*ImportExpression/u)
  }
})

test('Code Mode supports top-level await and injected tools without module loading', async () => {
  const executor = new CodeModeExecutor(createCaptureRegistry())
  try {
    const result = await executor.run(
      "await Promise.resolve(); const captured = await tools.capture({ value: 'from-tool' }); return captured.body",
      { allowedToolNames: ['capture'] },
    )
    assert.equal(result.status, 'success')
    assert.equal(result.toolCalls.length, 1)
    assert.equal(result.output, '{"value":"from-tool"}')
  } finally {
    await executor.dispose()
  }
})
