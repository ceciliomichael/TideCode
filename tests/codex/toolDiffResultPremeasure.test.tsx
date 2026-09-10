import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ToolInvocationBlock } from '../../src/components/chat/ToolInvocationBlock'
import type { ToolInvocationTrace } from '../../src/types/chat'

function createCompletedInvocation(overrides: Partial<ToolInvocationTrace>): ToolInvocationTrace {
  return {
    argumentsText: '{}',
    completedAt: 2,
    id: 'tool-1',
    resultContent: 'completed',
    startedAt: 1,
    state: 'completed',
    toolName: 'write',
    ...overrides,
  }
}

test('collapsed write tool mounts its diff in the hidden premeasure container', () => {
  const invocation = createCompletedInvocation({
    resultPresentation: {
      fileName: 'src/example.ts',
      kind: 'file_diff',
      newContent: 'const value = 2\n',
      oldContent: 'const value = 1\n',
    },
  })

  const markup = renderToStaticMarkup(createElement(ToolInvocationBlock, { invocation }))

  assert.match(markup, /data-tool-diff-result="premeasure"/u)
  assert.match(markup, /pointer-events-none invisible absolute inset-x-0 top-0 h-0 overflow-hidden/u)
  assert.match(markup, /height:160px/u)
})

test('collapsed edit tool mounts every grouped change diff for premeasurement', () => {
  const invocation = createCompletedInvocation({
    toolName: 'edit',
    resultPresentation: {
      kind: 'change_diff',
      changes: [
        {
          fileName: 'src/example.ts',
          kind: 'update',
          newContent: 'const first = 2\n',
          oldContent: 'const first = 1\n',
          startLineNumber: 10,
        },
        {
          fileName: 'src/example.ts',
          kind: 'update',
          newContent: 'const second = 2\n',
          oldContent: 'const second = 1\n',
          startLineNumber: 20,
        },
      ],
    },
  })

  const markup = renderToStaticMarkup(createElement(ToolInvocationBlock, { invocation }))

  assert.match(markup, /data-tool-diff-result="premeasure"/u)
  assert.equal(markup.split('height:160px').length - 1, 2)
})

test('collapsed non-diff tool leaves its result body unmounted', () => {
  const invocation = createCompletedInvocation({
    resultContent: 'RESULT_BODY_SHOULD_NOT_RENDER',
    resultPresentation: undefined,
    toolName: 'read',
  })

  const markup = renderToStaticMarkup(createElement(ToolInvocationBlock, { invocation }))

  assert.doesNotMatch(markup, /data-tool-diff-result=/u)
  assert.doesNotMatch(markup, /RESULT_BODY_SHOULD_NOT_RENDER/u)
})
