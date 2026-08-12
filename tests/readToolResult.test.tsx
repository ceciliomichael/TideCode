import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test from 'node:test'
import { LiteralToolResult } from '../src/components/chat/LiteralToolResult'

function renderReadToolResult(content: string) {
  return renderToStaticMarkup(createElement(LiteralToolResult, { content }))
}

test('read tool output is rendered as literal numbered source text', () => {
  const markup = renderReadToolResult(
    '1: # heading\n2: **bold** and *italic*\n3: <span>literal HTML</span>\n4: ```\n5: - item',
  )

  assert.match(markup, /<pre[^>]*>1: # heading\n2: \*\*bold\*\* and \*italic\*\n3: &lt;span&gt;literal HTML&lt;\/span&gt;\n4: ```\n5: - item<\/pre>/u)
  assert.doesNotMatch(markup, /<h1|<strong|<em|<span|<ul|<code>/u)
})

test('read tool output preserves blank lines and whitespace', () => {
  const markup = renderReadToolResult('1: first\n\n2:   indented')

  assert.ok(markup.includes('1: first\n\n2:   indented'))
})
