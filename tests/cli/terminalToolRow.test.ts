import assert from 'node:assert/strict'
import test from 'node:test'
import { colors } from '../../electron/cli/renderer'
import { renderTerminalToolRowText } from '../../electron/cli/terminalToolRow'
import { stripAnsi } from '../../electron/cli/terminalText'

test('terminal tool rows use one neutral label with semantic status color', () => {
  const completed = renderTerminalToolRowText('Read WorkspaceMonacoEditor.tsx', 'completed')
  const failed = renderTerminalToolRowText('Read failed WorkspaceMonacoEditor.tsx', 'failed', 'failed')

  assert.equal(stripAnsi(completed), '[Read] WorkspaceMonacoEditor.tsx')
  assert.equal(stripAnsi(failed), '[Read] WorkspaceMonacoEditor.tsx')
  assert.ok(completed.includes(colors.success))
  assert.ok(failed.includes(colors.danger))
})
