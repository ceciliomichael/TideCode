import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatWebSearchAction,
  formatWebSearchResultAsMarkdown,
  getWebSearchSourceHost,
  normalizeWebSearchMarkdownBody,
  parseWebSearchToolResult,
  parseWebSearchToolResultBody,
} from '../src/lib/webSearchResults'

test('parses the AI SDK web search result shape and keeps source URLs clickable', () => {
  const result = parseWebSearchToolResult({
    action: {
      queries: ['latest Tidecode release', 'Tidecode changelog'],
      type: 'search',
    },
    sources: [
      { type: 'url', url: 'https://example.com/releases' },
      { type: 'url', url: 'https://example.com/releases' },
      { name: 'web', type: 'api' },
    ],
  })

  assert.deepEqual(result, {
    action: {
      queries: ['latest Tidecode release', 'Tidecode changelog'],
      type: 'search',
    },
    sources: [
      { type: 'url', url: 'https://example.com/releases' },
      { name: 'web', type: 'api' },
    ],
  })
  assert.equal(formatWebSearchAction(result?.action ?? null), 'Searched for latest Tidecode release · Tidecode changelog')
  assert.equal(getWebSearchSourceHost({ type: 'url', url: 'https://www.example.com/releases' }), 'example.com')
  assert.equal(
    formatWebSearchResultAsMarkdown(result ?? { action: null, sources: [] }),
    'Searched for latest Tidecode release · Tidecode changelog\n\n### Sources\n- [example.com/releases](<https://example.com/releases>)\n- web',
  )
  assert.equal(normalizeWebSearchMarkdownBody(JSON.stringify(result)), formatWebSearchResultAsMarkdown(result!))
})

test('normalizes Responses-style web search calls and citation annotations', () => {
  const result = parseWebSearchToolResultBody(JSON.stringify([
    {
      action: {
        query: 'OpenAI web search',
        sources: [{ type: 'url', url: 'https://search.example/candidate' }],
        type: 'search',
      },
      id: 'ws_123',
      status: 'completed',
      type: 'web_search_call',
    },
    {
      content: [{
        annotations: [{
          title: 'OpenAI documentation',
          type: 'url_citation',
          url: 'https://developers.openai.com/docs',
        }],
        text: 'Search-backed answer',
        type: 'output_text',
      }],
      role: 'assistant',
      type: 'message',
    },
  ]))

  assert.equal(result?.action?.type, 'search')
  assert.deepEqual(result?.sources, [
    { type: 'url', url: 'https://search.example/candidate' },
    { title: 'OpenAI documentation', type: 'url', url: 'https://developers.openai.com/docs' },
  ])
})

test('rejects unsafe or malformed source URLs while preserving a valid search action', () => {
  const result = parseWebSearchToolResult({
    action: {
      type: 'open_page',
      url: 'javascript:alert(1)',
    },
    sources: [
      { type: 'url', url: 'javascript:alert(1)' },
      { type: 'url', url: 'not-a-url' },
    ],
  })

  assert.deepEqual(result, {
    action: {
      type: 'openPage',
    },
    sources: [],
  })
})

test('returns null for unrelated provider output so the renderer can use its safe fallback', () => {
  assert.equal(parseWebSearchToolResult({ message: 'not a web search result' }), null)
  assert.equal(parseWebSearchToolResultBody('not json'), null)
})
