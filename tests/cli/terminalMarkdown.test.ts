import test from 'node:test'
import assert from 'node:assert/strict'
import { colors } from '../../electron/cli/renderer'
import { formatInlineMarkdown } from '../../electron/cli/terminalMarkdown'
import { stripAnsi } from '../../electron/cli/terminalText'

test('terminal inline code preserves underscores literally', () => {
  const rendered = formatInlineMarkdown('Use `plan_create`, then `plan_update`.')

  assert.equal(stripAnsi(rendered), 'Use plan_create, then plan_update.')
  assert.ok(rendered.includes(`${colors.info}plan_create${colors.reset}`))
  assert.ok(rendered.includes(`${colors.info}plan_update${colors.reset}`))
})

test('terminal inline code preserves multiple underscores in one span', () => {
  const rendered = formatInlineMarkdown('Call `a_b_c`.')

  assert.equal(stripAnsi(rendered), 'Call a_b_c.')
  assert.ok(rendered.includes(`${colors.info}a_b_c${colors.reset}`))
})

test('terminal markdown still formats underscore italics outside inline code', () => {
  const rendered = formatInlineMarkdown('_italic_ and `a_b_c`')

  assert.equal(stripAnsi(rendered), 'italic and a_b_c')
  assert.ok(rendered.includes(`${colors.italic}italic${colors.reset}`))
  assert.ok(rendered.includes(`${colors.info}a_b_c${colors.reset}`))
})
