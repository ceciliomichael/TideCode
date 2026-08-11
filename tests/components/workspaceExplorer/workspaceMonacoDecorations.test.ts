import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkspaceMonacoLineDecorations } from '../../../src/components/workspaceExplorer/workspaceFileEditor/workspaceMonacoDecorations'

test('workspace Monaco line decorations are ordered and retain Git status', () => {
  const statuses = new Map([
    [7, 'changed' as const],
    [2, 'added' as const],
  ])

  assert.deepEqual(createWorkspaceMonacoLineDecorations(statuses), [
    { lineNumber: 2, status: 'added' },
    { lineNumber: 7, status: 'changed' },
  ])
})
