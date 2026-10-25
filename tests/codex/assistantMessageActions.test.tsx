import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test from 'node:test'
import { AssistantGenerationMetadata, AssistantMessage } from '../../src/components/AssistantMessage'

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

test('metadata menu stays hidden until the full AI turn finishes', () => {
  const props = {
    content: 'Response',
    showCopyButton: true,
    onBranch: () => undefined,
    timestamp: 1,
    generationMetrics: { outputTokens: 12, generationMs: 1000, toolExecutionMs: 2000, estimated: true },
  }
  for (const streamingState of [
    { isStreaming: true, isConversationStreaming: true },
    { isStreaming: false, isConversationStreaming: true },
  ]) {
    const markup = renderToStaticMarkup(createElement(AssistantMessage, { ...props, ...streamingState }))
    assert.doesNotMatch(markup, /aria-label="Message actions"/u)
  }
  const completed = renderToStaticMarkup(createElement(AssistantMessage, props))
  assert.match(completed, /aria-label="Message actions"/u)
})

test('metadata shows only approximate tokens per second without a tooltip', () => {
  const metrics = { outputTokens: 120, generationMs: 2000, toolExecutionMs: 5000, estimated: true }
  const estimated = renderToStaticMarkup(createElement(AssistantGenerationMetadata, { metrics }))
  assert.match(estimated, /≈ 60\.0 tok\/s/u)
  assert.match(estimated, /Tokens per second/u)
  assert.doesNotMatch(estimated, /title=|role="tooltip"/u)
  assert.doesNotMatch(estimated, /Output tokens|Generating|Tool execution|Response totals|Estimated tokens/u)
  const reported = renderToStaticMarkup(createElement(AssistantGenerationMetadata, {
    metrics: { ...metrics, estimated: false },
  }))
  assert.match(reported, /≈ 60\.0 tok\/s/u)
  const instant = renderToStaticMarkup(createElement(AssistantGenerationMetadata, {
    metrics: { ...metrics, generationMs: 0 },
  }))
  assert.match(instant, /Measuring…/u)
  assert.doesNotMatch(instant, /Infinity|NaN/u)
})
