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

test('collapsed write tool leaves its heavy diff unmounted', () => {
  const invocation = createCompletedInvocation({
    resultPresentation: {
      fileName: 'src/example.ts',
      kind: 'file_diff',
      newContent: 'const value = 2\n',
      oldContent: 'const value = 1\n',
    },
  })

  const markup = renderToStaticMarkup(createElement(ToolInvocationBlock, { invocation }))

  assert.doesNotMatch(markup, /data-tool-diff-result=/u)
  assert.doesNotMatch(markup, /workspace-monaco-diff/u)
  assert.doesNotMatch(markup, /height:160px/u)
})

test('collapsed edit tool leaves grouped change diffs unmounted', () => {
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

  assert.doesNotMatch(markup, /data-tool-diff-result=/u)
  assert.equal(markup.split('height:160px').length - 1, 0)
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
