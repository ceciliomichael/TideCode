import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createWorkspaceMonacoLineDecorations,
  toMonacoModelDecorations,
} from '../../../src/components/workspaceExplorer/workspaceFileEditor/workspaceMonacoDecorations'

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

test('workspace Monaco Git markers render in the line-decoration gutter', () => {
  const monaco = {
    Range: class {
      constructor(
        readonly startLineNumber: number,
        readonly startColumn: number,
        readonly endLineNumber: number,
        readonly endColumn: number,
      ) {}
    },
  }

  const [decoration] = toMonacoModelDecorations(monaco as never, [
    { lineNumber: 4, status: 'changed' },
  ])

  assert.equal(decoration?.options.linesDecorationsClassName, 'workspace-monaco-line-changed')
  assert.equal(decoration?.options.glyphMarginClassName, undefined)
})
