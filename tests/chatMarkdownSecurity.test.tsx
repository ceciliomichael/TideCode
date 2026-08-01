import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test from 'node:test'
import { MarkdownRenderer } from '../src/components/chat/MarkdownRenderer'

function renderMarkdown(content: string) {
  return renderToStaticMarkup(
    createElement(MarkdownRenderer, {
      content,
      preserveLineBreaks: true,
    }),
  )
}

test('chat markdown strips streamed style, script, event, and inline-style injection', () => {
  const markup = renderMarkdown(
    '<style>body { display: none }</style><script>alert("xss")</script><div style="position:fixed" onclick="alert(1)">Visible text</div>',
  )

  assert.match(markup, /Visible text/u)
  assert.doesNotMatch(markup, /<style|<script|display:\s*none|position:\s*fixed|onclick|alert\(/iu)
})

test('chat markdown keeps the intentionally supported safe formatting tags', () => {
  const markup = renderMarkdown('<details><summary>Sources</summary><mark>Important</mark> ^2^ ~n~</details>')

  assert.match(markup, /<details/u)
  assert.match(markup, /<summary[^>]*>Sources<\/summary>/u)
  assert.match(markup, /<mark[^>]*>Important<\/mark>/u)
  assert.match(markup, /<sup[^>]*>2<\/sup>/u)
  assert.match(markup, /<sub[^>]*>n<\/sub>/u)
})

test('chat markdown renders an unfenced HTML document as an HTML code block', () => {
  const markup = renderMarkdown('Final: Write it.\n\n<!\nDOCTYPE html>\n<html><body>#cross { position: absolute; }</body></html>')

  assert.match(markup, /<pre/u)
  assert.match(markup, /DOCTYPE html/u)
})
