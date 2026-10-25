import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { AgentToolExecutionResult } from '../../electron/chat/shared/toolTypes'
import { electronApp } from '../../electron/electronApp'
import { prepareToolExecutionResultForModel } from '../../electron/chat/shared/toolReplay'
import { formatImplicitCodeModeToolResults } from '../../src/lib/codeModeResultOutput'
import { createAgentToolBundle } from '../../electron/chat/shared/tools'

const createAgentTools = async (...args: Parameters<typeof createAgentToolBundle>) =>
  (await createAgentToolBundle(...args)).nativeTools
import {
  appendToolOutput,
  cleanupStaleToolOutputs,
  getToolOutputDirectory,
  persistToolOutput,
  resolveToolOutputAliasPath,
} from '../../electron/chat/shared/tools/toolOutputStore'

test('cleanup retains stale output referenced by persisted history', async () => {
  const home = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-output-retention-'))
  const originalGetPath = electronApp.getPath
  try {
    electronApp.getPath = () => home
    const retained = await persistToolOutput('referenced result')
    const orphaned = await persistToolOutput('unreferenced result')
    const oldDate = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000)
    await fs.utimes(retained.absolutePath, oldDate, oldDate)
    await fs.utimes(orphaned.absolutePath, oldDate, oldDate)
    const historyDir = path.join(home, '.tidecode', 'history', 'canonical-history')
    await fs.mkdir(historyDir, { recursive: true })
    await fs.writeFile(path.join(historyDir, 'chat.json'), JSON.stringify({
      output: retained.aliasPath,
    }))
    await cleanupStaleToolOutputs()
    assert.equal(await fs.readFile(retained.absolutePath, 'utf8'), 'referenced result')
    await assert.rejects(fs.stat(orphaned.absolutePath), { code: 'ENOENT' })
  } finally {
    electronApp.getPath = originalGetPath
    await fs.rm(home, { recursive: true, force: true })
  }
})

test('large implicit Code Mode results are preserved before model projection', async () => {
  const home = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-output-implicit-'))
  const originalGetPath = electronApp.getPath
  try {
    electronApp.getPath = () => home
    const full = formatImplicitCodeModeToolResults([{
      name: 'tools.grep',
      status: 'success',
      summary: 'Large search',
      body: 'match result\n'.repeat(5_000),
    }])
    assert.ok(full.length > 32_000)
    const bounded = await prepareToolExecutionResultForModel({
      result: { status: 'success', summary: 'Executed Code Mode', body: full },
      toolName: 'exec',
    })
    assert.equal(bounded.truncated, true)
    const outputPath = bounded.semantics?.output_path
    assert.equal(typeof outputPath, 'string')
    assert.equal(await fs.readFile(resolveToolOutputAliasPath(String(outputPath)).absolutePath, 'utf8'), full)
  } finally {
    electronApp.getPath = originalGetPath
    await fs.rm(home, { recursive: true, force: true })
  }
})

async function executeTool(
  execute: unknown,
  input: Record<string, unknown>,
): Promise<AgentToolExecutionResult> {
  assert.equal(typeof execute, 'function')
  return await (execute as (
    value: Record<string, unknown>,
    options: { context: Record<string, never>; messages: never[]; toolCallId: string },
  ) => Promise<AgentToolExecutionResult>)(input, {
    context: {},
    messages: [],
    toolCallId: 'tool-output-test',
  })
}

test('truncated output is saved behind @tool-output and recovered with normal read and grep tools', async () => {
  const tempHomePath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-tool-output-home-'))
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-tool-output-workspace-'))
  const originalGetPath = electronApp.getPath

  try {
    electronApp.getPath = () => tempHomePath
    const largeBody = Array.from({ length: 3_000 }, (_value, index) => 'large line ' + index).join('\n')
    const boundedResult = await prepareToolExecutionResultForModel({
      result: { body: largeBody, status: 'success', summary: 'Large output' },
      toolName: 'execute_terminal',
    })

    const outputPath = boundedResult.semantics?.output_path
    assert.equal(typeof outputPath, 'string')
    assert.match(String(outputPath), /^@tool-output\/tool_\d{5}\.txt$/u)
    assert.equal((boundedResult.body ?? '').includes(String(outputPath)), true)
    assert.match(boundedResult.body ?? '', /~\/\.tidecode\/tool-output/u)
    assert.match(boundedResult.body ?? '', /tools\.grep/u)
    assert.match(boundedResult.body ?? '', /next_offset/u)
    assert.match(boundedResult.body ?? '', /next_cursor/u)
    assert.doesNotMatch(boundedResult.body ?? '', /output_id|read_tool_output/u)

    const resolved = resolveToolOutputAliasPath(String(outputPath))
    assert.equal(resolved.absolutePath.startsWith(getToolOutputDirectory()), true)
    assert.equal(await fs.readFile(resolved.absolutePath, 'utf8'), largeBody)

    const tools = await createAgentTools(
      { workspaceRootPath },
      { chatMode: 'agent' },
    )

    const readResult = await executeTool(tools.read.execute, {
      limit: 2,
      offset: 2_999,
      path: outputPath,
    })
    assert.equal(readResult.status, 'success')
    assert.match(readResult.body ?? '', /large line 2998\nlarge line 2999/u)
    assert.equal(readResult.subject?.path, outputPath)

    const grepResult = await executeTool(tools.grep.execute, {
      path: '@tool-output/',
      pattern: 'large line 2999',
    })
    assert.equal(grepResult.status, 'success')
    assert.match(grepResult.body ?? '', /@tool-output\/tool_\d{5}\.txt/u)
    assert.equal((grepResult.body ?? '').includes(tempHomePath), false)
  } finally {
    electronApp.getPath = originalGetPath
    await fs.rm(tempHomePath, { force: true, recursive: true })
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})

test('tool output files use readable aliases and support append-only terminal recovery', async () => {
  const tempHomePath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-tool-output-append-'))
  const originalGetPath = electronApp.getPath

  try {
    electronApp.getPath = () => tempHomePath
    const stored = await persistToolOutput('one\ntwo\n')
    assert.match(stored.aliasPath, /^@tool-output\/tool_\d{5}\.txt$/u)
    assert.equal(stored.absolutePath, resolveToolOutputAliasPath(stored.aliasPath).absolutePath)

    await appendToolOutput(stored.aliasPath, 'three\nfour\n')
    assert.equal(await fs.readFile(stored.absolutePath, 'utf8'), 'one\ntwo\nthree\nfour\n')
  } finally {
    electronApp.getPath = originalGetPath
    await fs.rm(tempHomePath, { force: true, recursive: true })
  }
})

test('single-line tool output recovery pages with next_cursor without creating another truncation output', async () => {
  const tempHomePath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-tool-output-single-line-'))
  const workspaceRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-tool-output-single-line-workspace-'))
  const originalGetPath = electronApp.getPath

  try {
    electronApp.getPath = () => tempHomePath
    const marker = 'UNIQUE_RECOVERY_MARKER'
    const hugeSingleLine = `${'a'.repeat(5_000)}${marker}${'b'.repeat(5_000)}`
    const boundedResult = await prepareToolExecutionResultForModel({
      result: { body: hugeSingleLine, status: 'success', summary: 'Huge JSON-like output' },
      toolName: 'execute_terminal',
    })
    const outputPath = boundedResult.semantics?.output_path
    assert.equal(typeof outputPath, 'string')

    const tools = await createAgentTools(
      { workspaceRootPath },
      { chatMode: 'agent' },
    )
    let cursor: string | undefined
    let recovered = ''

    for (let page = 0; page < 10; page += 1) {
      const readResult = await executeTool(tools.read.execute, {
        ...(cursor ? { cursor } : {}),
        path: outputPath,
      })
      assert.equal(readResult.status, 'success')
      assert.equal(readResult.truncated, undefined)
      const preparedRead = await prepareToolExecutionResultForModel({
        result: readResult,
        toolName: 'read',
      })
      assert.equal(preparedRead.truncated, undefined)
      assert.equal(preparedRead.semantics?.output_path, undefined)
      assert.ok(Buffer.byteLength(preparedRead.body ?? '', 'utf8') <= 32 * 1024)
      recovered += readResult.body ?? ''
      if (recovered.includes(marker)) break
      cursor = readResult.semantics?.next_cursor as string | undefined
      assert.equal(typeof cursor, 'string')
      assert.equal(readResult.semantics?.next_offset, undefined)
    }

    assert.match(recovered, new RegExp(marker, 'u'))
  } finally {
    electronApp.getPath = originalGetPath
    await fs.rm(tempHomePath, { force: true, recursive: true })
    await fs.rm(workspaceRootPath, { force: true, recursive: true })
  }
})
