import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { AgentToolExecutionResult } from '../../electron/chat/shared/toolTypes'
import { electronApp } from '../../electron/electronApp'
import { prepareToolExecutionResultForModel } from '../../electron/chat/shared/toolReplay'
import { createNativeAgentTools as createAgentTools } from '../../electron/chat/shared/tools'
import {
  appendToolOutput,
  getToolOutputDirectory,
  persistToolOutput,
  resolveToolOutputAliasPath,
} from '../../electron/chat/shared/tools/toolOutputStore'

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
    assert.match(boundedResult.body ?? '', /Use grep to search it or read with a narrow offset\/limit/u)
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
