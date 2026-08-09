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

test('chat markdown gives ordered lists a shared, sized marker gutter', () => {
  const markup = renderMarkdown(
    '1. First item\n2. Second item\n3. Third item\n4. Fourth item\n5. Fifth item\n6. Sixth item\n7. Seventh item\n8. Eighth item\n9. Ninth item\n10. Tenth item',
  )

  assert.match(markup, /markdown-ordered-list/u)
  assert.match(markup, /markdown-list-item/u)
  assert.match(markup, /markdown-list-item-content/u)
  assert.match(markup, /--markdown-ordered-list-marker-digits:2/u)
})

test('chat markdown preserves the starting number for custom ordered lists', () => {
  const markup = renderMarkdown('10. First item\n11. Second item')

  assert.match(markup, /<ol[^>]*start="10"/u)
  assert.match(markup, /--markdown-ordered-list-counter-start:9/u)
})
