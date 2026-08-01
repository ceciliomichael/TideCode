import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getCopyableAssistantMessageText,
  normalizeMarkdownText,
} from '../src/lib/chatMessageContent'

test('normalizeMarkdownText repairs dangling double-backtick code fence endings', () => {
  const input = '```ts\nconst value = 1\n``'
  assert.equal(normalizeMarkdownText(input), '```ts\nconst value = 1\n```')
})

test('normalizeMarkdownText appends a closing code fence for unmatched blocks', () => {
  const input = '```html\n<section>hero</section>'
  assert.equal(normalizeMarkdownText(input), '```html\n<section>hero</section>\n```')
})

test('normalizeMarkdownText inserts paragraph spacing between glued reasoning sections', () => {
  const input = "Let's make it functional and easy to paste!Designing the hero section\nNext line"
  assert.equal(
    normalizeMarkdownText(input),
    "Let's make it functional and easy to paste!\n\nDesigning the hero section\nNext line",
  )
})

test('normalizeMarkdownText does not split <!DOCTYPE html> or ellipsis', () => {
  const input = 'Structure:\n<!DOCTYPE html>\n...'
  assert.equal(normalizeMarkdownText(input), 'Structure:\n<!DOCTYPE html>\n...')
})

test('getCopyableAssistantMessageText excludes reasoning content and think tags', () => {
  assert.equal(
    getCopyableAssistantMessageText({
      content: 'Visible answer\n\n<think>internal steps</think>',
      reasoningContent: 'More internal steps',
    }),
    'Visible answer',
  )
})

test('getCopyableAssistantMessageText does not copy reasoning-only messages', () => {
  assert.equal(
    getCopyableAssistantMessageText({
      content: '',
      reasoningContent: '<think>secret</think> reasoning only',
    }),
    '',
  )
})
