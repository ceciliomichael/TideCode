import assert from 'node:assert/strict'
import test from 'node:test'
import { highlightCodeLines, resolveHighlightLanguage } from '../src/lib/codeHighlighting'

test('resolveHighlightLanguage maps common file extensions to shiki language ids', () => {
  assert.equal(resolveHighlightLanguage({ fileName: 'src/App.tsx' }), 'tsx')
  assert.equal(resolveHighlightLanguage({ fileName: 'script.py' }), 'python')
  assert.equal(resolveHighlightLanguage({ fileName: 'README.md' }), 'markdown')
  assert.equal(resolveHighlightLanguage({ fileName: 'Dockerfile' }), 'docker')
  assert.equal(resolveHighlightLanguage({ fileName: 'Makefile' }), 'make')
})

test('resolveHighlightLanguage preserves explicit fenced language labels when possible', () => {
  assert.equal(resolveHighlightLanguage({ language: 'tsx' }), 'tsx')
  assert.equal(resolveHighlightLanguage({ language: 'py' }), 'python')
  assert.equal(resolveHighlightLanguage({ language: 'jsonc' }), 'jsonc')
})

test('highlightCodeLines keeps Markdown ordered-list markers in the document color', async () => {
  const lines = await highlightCodeLines({
    code: [
      '1. Web search and browsing',
      '9. **CTA band** - final conversion banner',
      '10. **Footer** - columns of links, copyright, social icons',
      '11. Terminal output reading',
    ].join('\n'),
    fileName: 'plan-001.md',
    theme: 'dark',
  })

  for (const line of lines) {
    const markerMatch = line.text.match(/^\s*\d+\.(?=\s)/u)
    assert.ok(markerMatch)

    const markerEnd = markerMatch[0].length
    let tokenStart = 0
    for (const token of line.tokens) {
      const tokenEnd = tokenStart + token.content.length
      if (tokenStart < markerEnd && tokenEnd > 0) {
        assert.equal(token.color, undefined, `ordered-list marker token was colored: ${token.content}`)
      }
      tokenStart = tokenEnd
    }
  }
})
