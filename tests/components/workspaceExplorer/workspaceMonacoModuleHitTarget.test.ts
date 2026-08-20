import assert from 'node:assert/strict'
import test from 'node:test'
import type { editor, Position } from 'monaco-editor'
import { findWorkspaceMonacoModuleSpecifierRanges } from '../../../src/components/workspaceExplorer/workspaceFileEditor/workspaceMonacoModuleDefinition'
import { resolveWorkspaceMonacoModuleHitTarget } from '../../../src/components/workspaceExplorer/workspaceFileEditor/workspaceMonacoModuleHitTarget'

function position(lineNumber: number, column: number) {
  return { lineNumber, column } as Position
}

test('module hit testing falls back to the rendered full path at token boundaries', () => {
  const line = "import value from './alpha/beta/gamma'"
  const [range] = findWorkspaceMonacoModuleSpecifierRanges(line)
  assert.ok(range)

  const editorNode = {
    getBoundingClientRect: () => ({
      bottom: 400,
      height: 200,
      left: 100,
      right: 1100,
      top: 200,
      width: 1000,
    }),
  }
  const editorInstance = {
    getDomNode: () => editorNode,
    getModel: () => ({ getLineContent: () => line }),
    getScrolledVisiblePosition: ({ column }: { column: number }) => ({
      height: 20,
      left: column * 8,
      top: 0,
    }),
    getTargetAtClientPoint: () => ({
      position: position(1, line.length + 1),
    }),
  } as unknown as editor.IStandaloneCodeEditor

  const clientX = 100 + ((range.startColumn + range.endColumn) / 2) * 8
  const target = resolveWorkspaceMonacoModuleHitTarget(
    editorInstance,
    clientX,
    210,
    position(1, line.length + 1),
  )

  assert.deepEqual(target?.range, range)
})

test('module hit testing does not claim whitespace outside the rendered path', () => {
  const line = "import value from './alpha/beta/gamma'"
  const editorInstance = {
    getDomNode: () => ({
      getBoundingClientRect: () => ({
        bottom: 400,
        height: 200,
        left: 100,
        right: 1100,
        top: 200,
        width: 1000,
      }),
    }),
    getModel: () => ({ getLineContent: () => line }),
    getScrolledVisiblePosition: ({ column }: { column: number }) => ({
      height: 20,
      left: column * 8,
      top: 0,
    }),
    getTargetAtClientPoint: () => ({ position: position(1, line.length + 1) }),
  } as unknown as editor.IStandaloneCodeEditor

  assert.equal(
    resolveWorkspaceMonacoModuleHitTarget(editorInstance, 1050, 210, position(1, line.length + 1)),
    null,
  )
})
