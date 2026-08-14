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

function createTurnHistory(turnCount: number, oversizedFirstTurn = false): ModelMessage[] {
  const messages: ModelMessage[] = []
  for (let turn = 1; turn <= turnCount; turn += 1) {
    messages.push({ role: 'user', content: `User request for turn ${turn}.` })
    messages.push({ role: 'assistant', content: `Assistant response for turn ${turn}.` })
    if (oversizedFirstTurn && turn === 1) {
      messages.push({
        role: 'assistant',
        content: `Large historical evidence ${'context '.repeat(12_000)}`,
      })
    }
  }
  return messages
}

function createCompactionInput(
  messages: ModelMessage[],
  createStream?: CompactionStreamFactory,
  retainedContextTokens?: number,
) {
  return {
    createStream,
    force: true,
    messages,
    model: 'test-model',
    reasoningEffort: 'low',
    systemPromptTokens: 100,
    toolSchemaTokens: 100,
    ...(retainedContextTokens === undefined ? {} : { retainedContextTokens }),
  }
}

function createSizedTurnHistory(turnCount: number): ModelMessage[] {
  const messages: ModelMessage[] = []
  for (let turn = 1; turn <= turnCount; turn += 1) {
    messages.push({
      role: 'user',
      content: `User request for turn ${turn}. ${'user-context '.repeat(400)}`,
    })
    messages.push({
      role: 'assistant',
      content: `Assistant response for turn ${turn}. ${'assistant-context '.repeat(400)}`,
    })
  }
  return messages
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

test('compaction retains a partial older turn when that fills the token target', () => {
  const messages = createSizedTurnHistory(6)

  const window = selectCompactionWindow(messages, 7_000, { retainedContextTokens: 7_000 })

  assert.ok(window)
  assert.equal(window.evictedMessages.filter((message) => message.role === 'user').length, 3)
  assert.equal(window.tailMessages.filter((message) => message.role === 'user').length, 3)
  assert.match(String(window.tailMessages[0]?.content), /User request for turn 4/u)
  assert.equal(hasUnresolvedToolCall(window.tailMessages), false)
})

test('forced compaction can summarize a short history while retaining its latest turn', () => {
  const messages = [
    ...createTurnHistory(2),
  ] as ModelMessage[]

  const window = selectCompactionWindow(messages, 1_000, { force: true })

  assert.ok(window)
  assert.equal(window.tailMessages[0]?.content, 'User request for turn 2.')
  assert.equal(window.tailMessages.filter((message) => message.role === 'user').length, 1)
  assert.equal(hasUnresolvedToolCall(window.tailMessages), false)
})

test('automatic compaction reports its start after the threshold and token boundary are met', async () => {
  const messages = [
    ...createTurnHistory(6, true),
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

test('automatic compaction requires an AI stream when five or more turns are eligible', async () => {
  const messages = [
    ...createTurnHistory(6, true),
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

test('AI compaction applies the configured retention token target to projected history', async () => {
  const result = await compactModelMessages(createCompactionInput(
    createSizedTurnHistory(6),
    createTextStreamFactory('## Goal\n- Continue the requested workspace change.'),
    7_000,
  ))

  assert.ok(result)
  const retainedUsers = result.projectedMessages
    .filter((message) => message.role === 'user')
    .map((message) => String(message.content))
  assert.equal(retainedUsers.length, 3)
  assert.match(retainedUsers[0] ?? '', /User request for turn 4/u)
  assert.match(retainedUsers[1] ?? '', /User request for turn 5/u)
  assert.match(retainedUsers[2] ?? '', /User request for turn 6/u)
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
