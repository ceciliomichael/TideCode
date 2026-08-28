import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { AgentToolExecutionResult } from '../../electron/chat/shared/toolTypes'
import { electronApp } from '../../electron/electronApp'
import { createCanonicalToolModelOutput, prepareToolExecutionResultForModel } from '../../electron/chat/shared/toolReplay'
import { createReadToolOutputTool } from '../../electron/chat/shared/tools/readToolOutput'
import { persistToolOutput, readPersistedToolOutput } from '../../electron/chat/shared/tools/toolOutputStore'
import { getToolResultModelContent } from '../../src/lib/toolResultContent'

test('saved tool output can be recovered through the same paged contract and presentation as read', async () => {
  const tempHomePath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-tool-output-'))
  const originalGetPath = electronApp.getPath

  try {
    electronApp.getPath = () => tempHomePath
    const largeBody = Array.from({ length: 3_000 }, (_value, index) => `large line ${index}`).join('\n')
    const boundedResult = await prepareToolExecutionResultForModel({
      result: { body: largeBody, status: 'success', summary: 'Large output' },
      toolName: 'execute_terminal',
    })
    const persistedOutputId = boundedResult.semantics?.output_id
    assert.equal(typeof persistedOutputId, 'string')
    assert.match(String(persistedOutputId), /^\d{5}$/u)
    assert.deepEqual(boundedResult.semantics, { output_id: persistedOutputId })
    assert.match(boundedResult.body ?? '', /read_tool_output/u)
    assert.match(boundedResult.body ?? '', new RegExp(`output_id: "${persistedOutputId}"`, 'u'))
    assert.doesNotMatch(boundedResult.body ?? '', /bytes omitted|original approximately|tokens/u)
    assert.match(boundedResult.body ?? '', /large line 2999/u)
    const persistedTail = await readPersistedToolOutput({
      limit: 1,
      offset: 3_000,
      outputId: String(persistedOutputId),
    })
    assert.equal(persistedTail.body, 'large line 2999')

    const outputId = await persistToolOutput('one\ntwo\nthree\nfour\nfive')
    assert.match(outputId, /^\d{5}$/u)
    const storedPage = await readPersistedToolOutput({ limit: 2, offset: 2, outputId })

    assert.deepEqual(storedPage, {
      body: 'two\nthree',
      endLine: 3,
      lineCount: 5,
      nextOffset: 4,
      outputId,
      returnedLineCount: 2,
      startLine: 2,
    })

    const readTool = createReadToolOutputTool()
    assert.equal(typeof readTool.execute, 'function')
    const result = await readTool.execute?.(
      { limit: 2, offset: 2, output_id: outputId },
      { context: {}, messages: [], toolCallId: 'read-output-1' },
    ) as AgentToolExecutionResult

    assert.equal(result.status, 'success')
    assert.equal(result.body, 'two\nthree')
    assert.equal(result.displayBody, 'two\nthree')
    assert.deepEqual(result.subject, { kind: 'tool_output', path: outputId })
    assert.deepEqual(result.semantics, {
      end_line: 3,
      next_offset: 4,
      output_id: outputId,
      start_line: 2,
      total_line_count: 5,
    })

    const modelOutput = createCanonicalToolModelOutput({
      argumentsValue: { limit: 2, offset: 2, output_id: outputId },
      output: result,
      toolCallId: 'read-output-1',
      toolName: 'read_tool_output',
    })
    assert.equal(modelOutput.type, 'text')
    assert.equal(
      getToolResultModelContent(String(modelOutput.value)),
      `Tool output: ${outputId}\nLines: 2-3 of 5\nNext offset: 4\n\ntwo\nthree`,
    )
  } finally {
    electronApp.getPath = originalGetPath
    await fs.rm(tempHomePath, { force: true, recursive: true })
  }
})
