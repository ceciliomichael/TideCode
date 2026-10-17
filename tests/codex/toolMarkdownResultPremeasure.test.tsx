import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ToolInvocationBlock } from '../../src/components/chat/ToolInvocationBlock'

function renderCollapsedToolResult(resultContent: string) {
  return renderToStaticMarkup(createElement(ToolInvocationBlock, {
    invocation: {
      argumentsText: '{}',
      id: 'tool-markdown-result',
      resultContent,
      startedAt: 1,
      state: 'completed',
      toolName: 'custom_tool',
    },
  }))
}

test('collapsed markdown tool result leaves fenced Monaco code blocks unmounted', () => {
  const markup = renderCollapsedToolResult('```ts\nconst first = 1\nconst second = 2\n```')

  assert.doesNotMatch(markup, /data-tool-markdown-result=/u)
  assert.doesNotMatch(markup, /data-code-renderer="monaco"/u)
  assert.doesNotMatch(markup, /height:56px/u)
  assert.doesNotMatch(markup, /height:160px/u)
})

test('collapsed text-only markdown tool result stays unmounted', () => {
  const markup = renderCollapsedToolResult('A short plain-text result.')

  assert.doesNotMatch(markup, /data-tool-markdown-result=/u)
  assert.doesNotMatch(markup, /A short plain-text result\./u)
})
