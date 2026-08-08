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
  const [line] = await highlightCodeLines({
    code: '10. **Footer** - columns of links, copyright, social icons',
    fileName: 'plan-001.md',
    theme: 'dark',
  })

  const markerToken = line.tokens.find((token) => token.content === '10.')
  assert.ok(markerToken)
  assert.equal(markerToken.color, undefined)
})
