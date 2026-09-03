import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test from 'node:test'
import { MarkdownRenderer } from '../src/components/chat/MarkdownRenderer'
import { ThinkingBlock } from '../src/components/chat/ThinkingBlock'
import { AssistantMessage } from '../src/components/AssistantMessage'

function renderMarkdown(content: string) {
  return renderToStaticMarkup(
    createElement(MarkdownRenderer, {
      content,
      preserveLineBreaks: true,
    }),
  )
}

function renderThinking(content: string) {
  return renderToStaticMarkup(
    createElement(ThinkingBlock, {
      content,
      isComplete: false,
      startTime: 0,
    }),
  )
}

function renderWaitingAssistant(isCompactionInProgress = false) {
  return renderToStaticMarkup(
    createElement(AssistantMessage, {
      content: '',
      isCompactionInProgress,
      isStreaming: true,
      isTextStreaming: false,
      timestamp: 0,
    }),
  )
}

test('compaction hides the empty assistant waiting indicator', () => {
  assert.match(renderWaitingAssistant(), /Thinking/u)
  assert.equal(renderWaitingAssistant(true), '')
})

test('running tool keeps the waiting indicator visible while assistant text is idle', () => {
  const toolInvocations = [
    {
      argumentsText: JSON.stringify({ path: 'src/example.ts' }),
      id: 'tool-read-running',
      startedAt: 1,
      state: 'running' as const,
      toolName: 'read',
    },
  ]
  const idleMarkup = renderToStaticMarkup(
    createElement(AssistantMessage, {
      content: '',
      isStreaming: true,
      isTextStreaming: false,
      timestamp: 0,
      toolInvocations,
    }),
  )
  const activeTextMarkup = renderToStaticMarkup(
    createElement(AssistantMessage, {
      content: '',
      isStreaming: true,
      isTextStreaming: true,
      timestamp: 0,
      toolInvocations,
    }),
  )

  assert.match(idleMarkup, /Reading example.ts/u)
  assert.match(idleMarkup, /Thinking/u)
  assert.match(activeTextMarkup, /Reading example.ts/u)
  assert.doesNotMatch(activeTextMarkup, /Thinking/u)
})

test('assistant renders one visible tool directly and groups multiple visible tools', () => {
  const createReadInvocation = (id: string, path: string) => ({
    argumentsText: JSON.stringify({ path }),
    id,
    resultContent: JSON.stringify({
      body: '1: example',
      schema: 'tidecode.tool_result/v1',
      status: 'success',
      subject: { kind: 'file', path },
      summary: 'Read file.',
      toolCallId: id,
      toolName: 'read',
    }),
    startedAt: 1,
    state: 'completed' as const,
    toolName: 'read',
  })

  const singleMarkup = renderToStaticMarkup(
    createElement(AssistantMessage, {
      content: '',
      timestamp: 0,
      toolInvocations: [createReadInvocation('read-one', 'src/one.ts')],
    }),
  )
  const groupedMarkup = renderToStaticMarkup(
    createElement(AssistantMessage, {
      content: '',
      timestamp: 0,
      toolInvocations: [
        createReadInvocation('read-one', 'src/one.ts'),
        createReadInvocation('read-two', 'src/two.ts'),
      ],
    }),
  )

  assert.match(singleMarkup, /Read one\.ts/u)
  assert.doesNotMatch(singleMarkup, /Explored 1 file/u)
  assert.match(groupedMarkup, /Explored 2 files/u)
  assert.doesNotMatch(groupedMarkup, /Read one\.ts|Read two\.ts/u)
})

test('chat markdown strips streamed style, script, event, and inline-style injection', () => {
  const markup = renderMarkdown(
    '<style>body { display: none }</style><script>alert("xss")</script><div style="position:fixed" onclick="alert(1)">Visible text</div>',
  )

  assert.match(markup, /Visible text/u)
  assert.doesNotMatch(markup, /<style|<script|display:\s*none|position:\s*fixed|onclick|alert\(/iu)
})

test('chat markdown does not render interactive input controls from compacted text', () => {
  const markup = renderMarkdown('The summary ended with an accidental <input type="text" /> control.')

  assert.match(markup, /The summary ended with an accidental/u)
  assert.doesNotMatch(markup, /<input/u)
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

test('ThinkingBlock keeps spacing between reasoning paragraphs and trims the final paragraph', () => {
  const markup = renderThinking('**Planning full file replacement using tools.edit**\n\nThe remaining reasoning keeps its paragraph spacing.')

  assert.match(markup, /<p node="\[object Object\]" class="my-0 mb-3 leading-\[1\.65\] text-foreground"><strong>Planning full file replacement using tools\.edit<\/strong><\/p>/u)
  assert.match(markup, /The remaining reasoning keeps its paragraph spacing/u)
  assert.match(markup, /\[&amp;&gt;\*:last-child\]:mb-0/u)
})
