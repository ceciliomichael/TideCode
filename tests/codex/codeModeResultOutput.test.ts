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
