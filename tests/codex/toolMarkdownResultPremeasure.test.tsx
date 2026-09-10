import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { containsMarkdownBlockCode } from '../../src/components/chat/MarkdownRenderer'
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

test('collapsed markdown tool result premeasures fenced Monaco code blocks', () => {
  const markup = renderCollapsedToolResult('```ts\nconst first = 1\nconst second = 2\n```')

  assert.match(markup, /data-tool-markdown-result="premeasure"/u)
  assert.match(markup, /data-code-renderer="monaco"/u)
  assert.match(markup, /height:56px/u)
  assert.doesNotMatch(markup, /height:160px/u)
})

test('collapsed text-only markdown tool result stays unmounted', () => {
  const markup = renderCollapsedToolResult('A short plain-text result.')

  assert.doesNotMatch(markup, /data-tool-markdown-result=/u)
  assert.doesNotMatch(markup, /A short plain-text result\./u)
})

test('markdown block-code detection covers rendered block-code forms only', () => {
  assert.equal(containsMarkdownBlockCode('```js\nconsole.log(1)\n```'), true)
  assert.equal(containsMarkdownBlockCode('    const indented = true'), true)
  assert.equal(containsMarkdownBlockCode('<pre><code>const raw = true</code></pre>'), true)
  assert.equal(containsMarkdownBlockCode('<!DOCTYPE html>\n<html><body>Page</body></html>'), true)
  assert.equal(containsMarkdownBlockCode('Use `inlineCode` here.'), false)
  assert.equal(containsMarkdownBlockCode('Plain text only.'), false)
})
