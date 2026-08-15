import assert from 'node:assert/strict'
import test from 'node:test'
import { splitTerminalToolLabel } from '../../electron/cli/terminalToolLabel'

test('terminal tool labels extract familiar desktop actions into tags', () => {
  assert.deepEqual(splitTerminalToolLabel('Edited file.md'), { action: 'Edited', subject: 'file.md' })
  assert.deepEqual(splitTerminalToolLabel('Read README.md'), { action: 'Read', subject: 'README.md' })
  assert.deepEqual(splitTerminalToolLabel('Searched workspace'), { action: 'Searched', subject: 'workspace' })
})

test('terminal tool labels keep unfamiliar summaries intact under a Tool tag', () => {
  assert.deepEqual(splitTerminalToolLabel('Custom operation finished'), {
    action: 'Tool',
    subject: 'Custom operation finished',
  })
})

test('terminal tool labels remove failure wording because color communicates status', () => {
  assert.deepEqual(splitTerminalToolLabel('Read failed WorkspaceMonacoEditor.tsx'), {
    action: 'Read',
    subject: 'WorkspaceMonacoEditor.tsx',
  })
})
