import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ContextIndicator } from '../../src/components/chat/ContextIndicator'
import { DashedMetricCircle } from '../../src/components/chat/DashedMetricCircle'
import type { ContextUsageEstimate } from '../../src/types/chat'

function renderIndicator(totalTokens: number) {
  const usage: ContextUsageEstimate = {
    historyTokens: totalTokens,
    injectionTokens: 0,
    maxTokens: 100,
    systemPromptTokens: 0,
    toolResultsTokens: 0,
    totalTokens,
  }
  return renderToStaticMarkup(<ContextIndicator usage={usage} />)
}

test('context indicator has a visible neutral ring even when no dashes are active', () => {
  const markup = renderIndicator(0)
  assert.equal((markup.match(/<path /gu) ?? []).length, 8)
  assert.equal((markup.match(/stroke="color-mix\(in srgb, var\(--color-muted-foreground\) 60%, var\(--color-surface\)\)"/gu) ?? []).length, 8)
  assert.match(markup, /stroke-width="2.25"/u)
  assert.match(markup, /height="20"/u)
})

test('context usage uses distinct brand, warning and danger active dashes', () => {
  assert.match(renderIndicator(25), /stroke="var\(--color-brand\)"/u)
  assert.match(renderIndicator(75), /stroke="var\(--color-warning-foreground\)"/u)
  assert.match(renderIndicator(90), /stroke="var\(--color-danger-foreground\)"/u)
  assert.doesNotMatch(renderIndicator(25), /stroke="var\(--color-action\)"/u)
})

test('context tooltip exposes the separate injection token row', () => {
  const source = readFileSync(new URL('../../src/components/chat/ContextIndicator.tsx', import.meta.url), 'utf8')
  assert.match(source, /<span>Injection<\/span>/u)
  assert.match(source, /formatTokenCount\(usage\.injectionTokens\)/u)
})

test('context percentage and compress action use theme foreground text', () => {
  // The tooltip contents mount only when opened, so test the class contract.
  const source = readFileSync(new URL('../../src/components/chat/ContextIndicator.tsx', import.meta.url), 'utf8')
  assert.match(source, /bg-accent[^']*text-foreground/u)
  assert.match(source, /bg-action[^']*text-foreground/u)
  assert.doesNotMatch(source, /text-action-foreground|text-accent-foreground/u)
})

test('shared dotted metric keeps its original geometry unless explicitly customized', () => {
  const markup = renderToStaticMarkup(<DashedMetricCircle percent={50} />)
  assert.match(markup, /stroke-width="1.5"/u)
  assert.match(markup, /height="18"/u)
  assert.equal((markup.match(/<path /gu) ?? []).length, 8)
})
