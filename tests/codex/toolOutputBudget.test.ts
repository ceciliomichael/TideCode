import assert from 'node:assert/strict'
import test from 'node:test'
import {
  projectToolOutputForModel,
  TOOL_OUTPUT_MAX_BYTES,
  TOOL_OUTPUT_MAX_LINE_LENGTH,
  TOOL_OUTPUT_MAX_LINES,
} from '../../electron/chat/shared/tools/toolOutputBudget'

test('tool output stays bounded by bytes and exposes a recovery id', () => {
  const result = projectToolOutputForModel(
    Array.from({ length: 8_000 }, (_value, index) => `line ${index} ${'x'.repeat(80)}`).join('\n'),
    'read-123',
  )

  assert.equal(result.truncated, true)
  assert.ok(Buffer.byteLength(result.text, 'utf8') < TOOL_OUTPUT_MAX_BYTES)
  assert.match(result.text, /Full output saved as read-123/u)
  assert.match(result.text, /read_tool_output/u)
  assert.doesNotMatch(result.text, /line 7999/u)
})

test('tool output caps long lines and line count independently', () => {
  const result = projectToolOutputForModel(
    `${'a'.repeat(TOOL_OUTPUT_MAX_LINE_LENGTH + 500)}\n${Array.from(
      { length: TOOL_OUTPUT_MAX_LINES + 10 },
      (_value, index) => `line ${index}`,
    ).join('\n')}`,
  )

  assert.equal(result.truncated, true)
  assert.ok(result.omittedLines > 0)
  assert.match(result.text, /line truncated/u)
  assert.match(result.text, /output truncated/u)
})

test('small tool output is returned byte-for-byte', () => {
  const value = 'one\ntwo\nthree'
  assert.deepEqual(projectToolOutputForModel(value), {
    omittedBytes: 0,
    omittedLines: 0,
    text: value,
    truncated: false,
  })
})
