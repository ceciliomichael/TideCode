import assert from 'node:assert/strict'
import test from 'node:test'
import {
  projectToolOutputForModel,
  TOOL_OUTPUT_MAX_BYTES,
  TOOL_OUTPUT_MAX_LINE_LENGTH,
  TOOL_OUTPUT_MAX_LINES,
} from '../../electron/chat/shared/tools/toolOutputBudget'

test('context-only output projection keeps a bounded head and tail with a compact recovery handle', () => {
  const result = projectToolOutputForModel(
    Array.from({ length: 8_000 }, (_value, index) => `line ${index} ${'x'.repeat(80)}`).join('\n'),
    '48317',
  )

  assert.equal(result.truncated, true)
  assert.ok(Buffer.byteLength(result.text, 'utf8') < TOOL_OUTPUT_MAX_BYTES)
  assert.match(result.text, /output_id: "48317"/u)
  assert.match(result.text, /read_tool_output/u)
  assert.match(result.text, /Omitted lines /u)
  assert.match(result.text, /line 0 /u)
  assert.match(result.text, /line 7999 /u)
  assert.doesNotMatch(result.text, /approximately|bytes omitted|tokens/u)

  const repeatedProjection = projectToolOutputForModel(result.text)
  assert.equal(repeatedProjection.truncated, false)
  assert.equal(repeatedProjection.text, result.text)
  assert.match(repeatedProjection.text, /output_id: "48317"/u)
})

test('tool output caps long lines and line count independently', () => {
  const result = projectToolOutputForModel(
    `${'a'.repeat(TOOL_OUTPUT_MAX_LINE_LENGTH + 500)}\n${Array.from(
      { length: TOOL_OUTPUT_MAX_LINES + 10 },
      (_value, index) => `line ${index}`,
    ).join('\n')}`,
  )

  assert.equal(result.truncated, true)
  assert.match(result.text, /middle of line truncated/u)
  assert.match(result.text, /^a+/u)
  assert.match(result.text, /line 2009/u)
  assert.match(result.text, /Output truncated/u)
  assert.ok(Buffer.byteLength(result.text, 'utf8') < TOOL_OUTPUT_MAX_BYTES)
  assert.ok(result.text.split(/\r?\n/u).length < TOOL_OUTPUT_MAX_LINES)
  assert.equal(
    projectToolOutputForModel(`File: src/example.ts\nLines: 1-2011 of 2011\n\n${result.text}`).truncated,
    false,
  )
})

test('small tool output is returned byte-for-byte', () => {
  const value = 'one\ntwo\nthree'
  assert.deepEqual(projectToolOutputForModel(value), {
    text: value,
    truncated: false,
  })
})

test('very large single-line output is truncated without materializing the full line as a character array', () => {
  const value = `head-${'x'.repeat(1_000_000)}-tail`
  const result = projectToolOutputForModel(value)

  assert.equal(result.truncated, true)
  assert.ok(result.text.length < 10_000)
  assert.match(result.text, /head-/u)
  assert.match(result.text, /-tail/u)
  assert.match(result.text, /middle of line truncated/u)
})
