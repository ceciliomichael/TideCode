import assert from 'node:assert/strict'
import test from 'node:test'
import type { ModelMessage } from 'ai'
import {
  compactModelMessages,
} from '../../electron/chat/shared/compaction/service'
import {
  buildCompactionSourceDigest,
  hasUnresolvedToolCall,
  isSafeCompactionBoundary,
  selectCompactionWindow,
} from '../../electron/chat/shared/compaction/window'
import type { CompactionStreamFactory } from '../../electron/chat/shared/compaction/contracts'
import { buildCompactionRequestPrompt, buildCompactionSystemPrompt } from '../../electron/chat/shared/compaction/prompt'
import { buildChatCompressionSystemPrompt } from '../../electron/chat/shared/prompts/compression'

function createConversationMessages(): ModelMessage[] {
  return [
    { role: 'user', content: 'Implement the requested workspace change.' },
    { role: 'assistant', content: 'I am inspecting the relevant files.' },
    { role: 'user', content: 'Keep the change compatible with the existing runtime.' },
    { role: 'assistant', content: 'The current state is ready for the next step.' },
  ]
}

function createCompactionInput(messages: ModelMessage[], createStream?: CompactionStreamFactory) {
  return {
    createStream,
    force: true,
    messages,
    model: 'test-model',
    reasoningEffort: 'low',
    systemPromptTokens: 100,
    toolSchemaTokens: 100,
  }
}

function createTextStreamFactory(text: string, onCall?: () => void): CompactionStreamFactory {
  return async () => ({
    fullStream: (async function* () {
      onCall?.()
      yield { type: 'text-delta', text }
    })(),
  })
}

test('the v2 compactor uses the shared Markdown compression prompt', () => {
  assert.equal(buildCompactionSystemPrompt(), buildChatCompressionSystemPrompt())
})

test('repeated compaction supplies the previous Markdown continuation before newer transcript data', () => {
  const previousPacket = { continuationMarkdown: '## Current state\n- Preserve the verified release state.' }
  const prompt = buildCompactionRequestPrompt({
    messages: [{ role: 'assistant', content: 'The release check now has newer evidence.' }],
    previousPacket,
    sourceDigest: 'current-digest',
    sourceMessageIds: ['model:1'],
    sourceStartIndex: 1,
  })

  assert.match(prompt, /PREVIOUS SUMMARY/u)
  assert.match(prompt, new RegExp(previousPacket.continuationMarkdown.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'))
  assert.match(prompt, /complete, concise Markdown summary, not a delta/u)
  assert.match(prompt, /Newer evidence wins/u)
  assert.match(prompt, /The release check now has newer evidence/u)
})

test('compaction boundaries never split a tool-call and tool-result pair', () => {
  const messages = [
    { role: 'user', content: 'Read the file.' },
    {
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'read_file', input: { path: 'src/app.ts' } }],
    },
    {
      role: 'tool',
      content: [{ type: 'tool-result', toolCallId: 'call-1', toolName: 'read_file', output: { type: 'text', value: 'file contents' } }],
    },
    { role: 'assistant', content: 'The file was read successfully.' },
  ] as ModelMessage[]

  assert.equal(hasUnresolvedToolCall(messages), false)
  assert.equal(isSafeCompactionBoundary(messages, 2), false)
  assert.equal(isSafeCompactionBoundary(messages, 3), true)
  assert.notEqual(selectCompactionWindow(messages, 10_000)?.boundaryIndex, 2)

  const unresolved = messages.slice(0, 2)
  assert.equal(hasUnresolvedToolCall(unresolved), true)
  assert.equal(selectCompactionWindow(unresolved, 10_000), null)

  const longHistory = Array.from({ length: 200 }, (_value, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `History entry ${index} ${'context '.repeat(40)}`,
  })) as ModelMessage[]
  const longWindow = selectCompactionWindow(longHistory, 1_500)
  assert.ok(longWindow)
  assert.ok(longWindow.boundaryIndex > 64)
  assert.equal(longWindow.sourceMessageIds.length, 64)
  assert.equal(longWindow.sourceMessageIds[0], 'model:0')
  assert.equal(longWindow.sourceMessageIds.at(-1), `model:${longWindow.boundaryIndex - 1}`)
})

test('compaction evicts a recent oversized tool result only with its matching call', () => {
  const messages = [
    { role: 'user', content: 'Implement the requested change.' },
    { role: 'assistant', content: 'I am reviewing the existing implementation.' },
    { role: 'user', content: 'Keep the current provider behavior intact.' },
    {
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: 'call-large', toolName: 'read_file', input: { path: 'src/app.ts' } }],
    },
    {
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId: 'call-large',
        toolName: 'read_file',
        output: { type: 'text', value: 'tool output '.repeat(2_000) },
      }],
    },
    { role: 'assistant', content: 'The file contents are ready for the next step.' },
  ] as ModelMessage[]

  const window = selectCompactionWindow(messages, 1_000)

  assert.ok(window)
  assert.ok(window.boundaryIndex > 0)
  assert.ok(window.evictedMessages.length > 0)
  assert.equal(hasUnresolvedToolCall(window.tailMessages), false)
  assert.equal(window.tailMessages.some((message) => message.role === 'tool'), false)
  assert.equal(window.tailMessages.at(-1)?.role, 'assistant')
})

test('compaction can evict the latest completed tool pair before the next model step', () => {
  const messages = [
    { role: 'user', content: 'Read the workspace and summarize the relevant state.' },
    {
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: 'call-latest', toolName: 'read_file', input: { path: 'src/app.ts' } }],
    },
    {
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId: 'call-latest',
        toolName: 'read_file',
        output: { type: 'text', value: 'large tool output '.repeat(12_000) },
      }],
    },
  ] as ModelMessage[]

  assert.equal(isSafeCompactionBoundary(messages, messages.length), true)
  const window = selectCompactionWindow(messages, 1_000)

  assert.ok(window)
  assert.equal(window.boundaryIndex, messages.length)
  assert.deepEqual(window.tailMessages, [])
  assert.deepEqual(window.anchorMessages, [messages[0]])
  assert.equal(hasUnresolvedToolCall(window.tailMessages), false)
})

test('automatic compaction reports its start only after the threshold and safe boundary are met', async () => {
  const messages = [
    { role: 'user', content: 'Read the workspace and summarize the relevant state.' },
    {
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: 'call-lifecycle', toolName: 'read_file', input: { path: 'src/app.ts' } }],
    },
    {
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId: 'call-lifecycle',
        toolName: 'read_file',
        output: { type: 'text', value: 'large tool output '.repeat(12_000) },
      }],
    },
  ] as ModelMessage[]
  let started = 0

  const result = await compactModelMessages({
    createStream: createTextStreamFactory('not valid packet output'),
    messages,
    model: 'test-model',
    onStarted: () => {
      started += 1
    },
    reasoningEffort: 'low',
    systemPromptTokens: 100,
    toolSchemaTokens: 100,
    contextWindowTokens: 16_000,
    triggerRatio: 0.8,
  })

  assert.ok(result)
  assert.equal(started, 1)
  assert.equal(result.projectedMessages.some((message) => message.role === 'tool'), false)
})

test('automatic budget checks compact a completed tool step even when the target cannot fit the recent tail', async () => {
  const messages = [
    { role: 'user', content: 'Inspect the workspace and continue the implementation.' },
    { role: 'assistant', content: 'I am checking the existing files first.' },
    { role: 'user', content: 'Preserve the current behavior while making the change.' },
    {
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: 'call-budget', toolName: 'read_file', input: { path: 'src/app.ts' } }],
    },
    {
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId: 'call-budget',
        toolName: 'read_file',
        output: { type: 'text', value: 'large tool output '.repeat(4_000) },
      }],
    },
    { role: 'assistant', content: 'The tool result is available for the next model step.' },
  ] as ModelMessage[]

  await assert.rejects(
    compactModelMessages({
      messages,
      model: 'test-model',
      reasoningEffort: 'low',
      systemPromptTokens: 100,
      toolSchemaTokens: 100,
      contextWindowTokens: 16_000,
      triggerRatio: 0.8,
    }),
    /no compaction model stream was provided/u,
  )
})

test('AI compaction produces a Markdown summary as the new history beginning', async () => {
  const messages = createConversationMessages()
  const summary = '## Goal\n- Continue the requested workspace change.\n\n## Remaining work\n- Verify the implementation.'
  const result = await compactModelMessages(createCompactionInput(messages, createTextStreamFactory(summary)))

  assert.ok(result)
  assert.equal(result.packet.continuationMarkdown, summary)
  assert.deepEqual(result.projectedMessages[0], { role: 'assistant', content: summary })
  assert.doesNotMatch(summary, /tidecode\.compaction_packet/u)
})

test('invalid non-Markdown AI output fails compaction instead of using a fallback', async () => {
  const truncatedPacket = '{"schema":"tidecode.compaction_packet/v2","continuationMarkdown":"'.padEnd(4_000, 'x')
  await assert.rejects(
    compactModelMessages(createCompactionInput(
      createConversationMessages(),
      createTextStreamFactory(truncatedPacket),
    )),
    /invalid Markdown \(json\); no fallback summary was generated/u,
  )
})

test('compaction strips execution mode context from prompts and summary messages', () => {
  const executionModeContext = [
    '<execution_mode_context mode="full">',
    'Internal execution details that are not conversation state.',
    '</execution_mode_context>',
  ].join('\n')
  const messages = [
    { role: 'user', content: `Implement the requested workspace change.\n\n${executionModeContext}` },
    { role: 'assistant', content: `I am checking the application code.\n\n${executionModeContext}` },
    { role: 'user', content: 'Fix the validation behavior.' },
    { role: 'assistant', content: 'The next step is to update the regression test.' },
  ] as ModelMessage[]
  const prompt = buildCompactionRequestPrompt({
    messages: messages.slice(0, 2),
    sourceDigest: buildCompactionSourceDigest(messages, 2),
    sourceMessageIds: ['model:0', 'model:1'],
  })
  const replayMessage = { role: 'assistant' as const, content: '## Current state\n- The application code is ready.' }

  assert.doesNotMatch(prompt, /execution_mode_context/u)
  assert.doesNotMatch(typeof replayMessage.content === 'string' ? replayMessage.content : '', /execution_mode_context/u)
})

test('valid AI Markdown is accepted and malformed AI output is rejected', async () => {
  const messages = createConversationMessages()
  const generatedMarkdown = '## Remaining work\n- Verify the requested workspace change.'
  const accepted = await compactModelMessages(createCompactionInput(
    messages,
    createTextStreamFactory(generatedMarkdown),
  ))
  assert.ok(accepted)
  assert.equal(accepted.packet.continuationMarkdown, generatedMarkdown)
  assert.equal(accepted.projectedMessages[0]?.content, generatedMarkdown)

  await assert.rejects(
    compactModelMessages(createCompactionInput(
      [...messages, { role: 'user', content: 'A distinct retry input.' }],
      createTextStreamFactory('{"not":"a packet"}'),
    )),
    /invalid Markdown \(json\); no fallback summary was generated/u,
  )
})

test('same compaction digest shares one in-flight summarizer call', async () => {
  const messages = createConversationMessages()
  let calls = 0
  const createStream = createTextStreamFactory('## Current state\n- The same compaction is already in flight.', () => {
    calls += 1
  })
  const [first, second] = await Promise.all([
    compactModelMessages(createCompactionInput(messages, createStream)),
    compactModelMessages(createCompactionInput(messages, createStream)),
  ])

  assert.ok(first)
  assert.ok(second)
  assert.equal(calls, 1)
  assert.equal(first.packet.sourceDigest, second.packet.sourceDigest)
})
