import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test from 'node:test'
import { AssistantMessage } from '../../src/components/AssistantMessage'

test('assistant actions stay right aligned and expose the branch menu trigger', () => {
  const markup = renderToStaticMarkup(createElement(AssistantMessage, {
    content: 'Completed response',
    onBranch: () => undefined,
    showCopyButton: true,
    timestamp: Date.now(),
  }))

  assert.match(markup, /absolute bottom-1\.5 right-0 flex items-center/u)
  assert.match(markup, /aria-label="Copy message"/u)
  assert.match(markup, /aria-label="Message actions"/u)
  assert.doesNotMatch(markup, /bottom-1\.5 left-0/u)
})
