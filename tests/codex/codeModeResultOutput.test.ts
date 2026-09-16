import assert from 'node:assert/strict'
import test from 'node:test'
import { formatExplicitCodeModeOutput } from '../../src/lib/codeModeResultOutput'

test('explicit Code Mode strings retain real line breaks', () => {
  assert.equal(
    formatExplicitCodeModeOutput('first line\nsecond line'),
    'first line\nsecond line',
  )
})

test('directly returned ToolResults expose their readable body without JSON escape sequences', () => {
  const output = formatExplicitCodeModeOutput({
    body: 'first line\nsecond line',
    semantics: { end_line: 2, start_line: 1 },
    status: 'success',
    subject: { kind: 'file', path: 'RELEASE_INSTRUCTIONS.md' },
    summary: 'Read RELEASE_INSTRUCTIONS.md',
  })

  assert.equal(output, 'first line\nsecond line')
  assert.doesNotMatch(output, /\\n/u)
  assert.doesNotMatch(output, /"semantics"/u)
})

test('ordinary structured Code Mode returns remain valid pretty-printed JSON', () => {
  const output = formatExplicitCodeModeOutput({
    lineCount: 2,
    summary: 'first line\nsecond line',
  })

  assert.deepEqual(JSON.parse(output), {
    lineCount: 2,
    summary: 'first line\nsecond line',
  })
  assert.match(output, /first line\\nsecond line/u)
})

test('nested ToolResults keep multiline bodies out of JSON string escaping', () => {
  const middleSentinel = 'MIDDLE OF IMPORTANT FILE CONTENT'
  const instructionsBody = [
    '# Engineering Rules',
    ...Array.from({ length: 120 }, (_value, index) => `rule ${index}: ${'x'.repeat(80)}`),
    middleSentinel,
    ...Array.from({ length: 120 }, (_value, index) => `tail ${index}: ${'y'.repeat(80)}`),
    'End of engineering rules.',
  ].join('\n')
  const catalogBody = '[\n  { "id": "deepseek-flash" }\n]'

  const output = formatExplicitCodeModeOutput({
    instructions: {
      body: instructionsBody,
      semantics: { end_line: 244, start_line: 1 },
      status: 'success',
      subject: { kind: 'file', path: 'AGENTS.md' },
      summary: 'Read AGENTS.md',
    },
    catalog: {
      body: catalogBody,
      status: 'success',
      subject: { kind: 'file', path: 'electron/models/catalog/deepseek_models.json' },
      summary: 'Read deepseek_models.json',
    },
  })

  assert.match(output, /"body": "\[ToolResult 1 body below\]"/u)
  assert.match(output, /"body": "\[ToolResult 2 body below\]"/u)
  assert.match(output, /"path": "AGENTS\.md"/u)
  assert.match(output, /"path": "electron\/models\/catalog\/deepseek_models\.json"/u)
  assert.match(output, /ToolResult 1 \(success\): Read AGENTS\.md/u)
  assert.match(output, /ToolResult 2 \(success\): Read deepseek_models\.json/u)
  assert.ok(output.includes(instructionsBody))
  assert.ok(output.includes(catalogBody))
  assert.ok(output.includes(middleSentinel))
  assert.doesNotMatch(output, /# Engineering Rules\\nrule 0/u)
})
