import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getCopyableAssistantMessageText,
  normalizeAssistantMessageContent,
  normalizeMarkdownText,
} from '../src/lib/chatMessageContent'
import { findTideFences } from '../src/lib/tideui/segments'

test('normalizeMarkdownText repairs dangling double-backtick code fence endings', () => {
  const input = '```ts\nconst value = 1\n``'
  assert.equal(normalizeMarkdownText(input), '```ts\nconst value = 1\n```')
})

test('normalizeMarkdownText appends a closing code fence for unmatched blocks', () => {
  const input = '```html\n<section>hero</section>'
  assert.equal(normalizeMarkdownText(input), '```html\n<section>hero</section>\n```')
})

test('assistant normalization preserves real completion boundaries for streamed TideUI and HTML previews', () => {
  for (const kind of ['tideui', 'tidehtml']) {
    const source = kind === 'tideui'
      ? 'panel "Dashboard"\n  chart bar "Activity"\n    point "Mon" 4\n'
      : '<strong>Still generating</strong>\n'
    const content = `Before\n\x60\x60\x60${kind}\n${source}`
    const normalized = normalizeAssistantMessageContent({ content }).content
    assert.equal(normalized, content)
    assert.equal(findTideFences(normalized)[0].closed, false)

    const completed = normalizeAssistantMessageContent({ content: `${content}\x60\x60\x60` }).content
    assert.equal(findTideFences(completed)[0].closed, true)
  }
})

test('incomplete TideUI declaration tokens and a partial closing fence stay unfinished', () => {
  let content = '```tideui\npanel "Dashboard"\n'
  for (const token of ['  metric ', '"Requests" ', '100', '\n', '`', '`']) {
    content += token
    const normalized = normalizeAssistantMessageContent({ content }).content
    assert.equal(normalized, content)
    assert.equal(findTideFences(normalized)[0].closed, false)
  }
})

test('ordinary code repair still works after a completed TideUI block', () => {
  const content = '```tideui\nmetric "Requests" 100\n```\n```ts\nconst value = 1'
  assert.equal(normalizeMarkdownText(content), `${content}\n\x60\x60\x60`)
})

test('Incomplete native opening fence tokens stay unchanged until their language is known', () => {
  const prefix = 'Here is the dashboard.\n\n'
  for (const opening of ['`', '``', '```', '```t', '```tide', '```tideui']) {
    const content = prefix + opening
    assert.equal(normalizeAssistantMessageContent({ content }).content, content)
  }
  assert.equal(normalizeMarkdownText('```ts\nconst value = 1\n``'), '```ts\nconst value = 1\n```')
})

test('normalizeMarkdownText does not close inline fences mentioned in quoted user prompts', () => {
  const input = [
    '### Prompt 1 (completed)',
    '> if the codeblock has no title in ``` then it should be blank',
    '',
    '### Prompt 2 (completed)',
    '> make image bigger',
  ].join('\n')

  assert.equal(normalizeMarkdownText(input), input)
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
