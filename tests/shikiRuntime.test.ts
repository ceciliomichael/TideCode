import assert from 'node:assert/strict'
import test from 'node:test'
import { getShikiRuntime, loadShikiLanguage } from '../src/lib/shikiRuntime'

test('Shiki shares one runtime and loads grammars only when requested', async () => {
  const [first, second] = await Promise.all([getShikiRuntime(), getShikiRuntime()])
  assert.equal(first, second)
  assert.equal(first.getLoadedLanguages().length, 0)
  await Promise.all([loadShikiLanguage('typescript'), loadShikiLanguage('typescript')])
  assert.ok(first.getLoadedLanguages().includes('typescript'))
  assert.equal(first.getLoadedLanguages().includes('python'), false)
  assert.equal(await loadShikiLanguage('text'), first)
  const tokens = first.codeToTokens('const answer = 42', { lang: 'typescript', theme: 'github-dark-default' })
  assert.ok(tokens.tokens[0].some((token) => token.content.includes('answer')))
})
