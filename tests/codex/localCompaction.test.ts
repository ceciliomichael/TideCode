import assert from 'node:assert/strict'
import test from 'node:test'
import type { ModelMessage } from 'ai'
import {
  buildFallbackCompactionPacket,
} from '../../electron/chat/shared/compaction/fallback'
import {
  compactModelMessages,
} from '../../electron/chat/shared/compaction/service'
import {
  buildCompactionMessage,
  buildCompactionSourceDigest,
  findLatestCompactionPacket,
  hasUnresolvedToolCall,
  isSafeCompactionBoundary,
  parseCompactionMessage,
  selectCompactionWindow,
} from '../../electron/chat/shared/compaction/window'
import type { CompactionStreamFactory } from '../../electron/chat/shared/compaction/contracts'

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

test('fallback compaction produces a parseable assistant continuation marker', async () => {
  const messages = createConversationMessages()
  const result = await compactModelMessages(createCompactionInput(messages))

  assert.ok(result)
  assert.equal(result.usedFallback, true)
  assert.equal(result.projectedMessages[0]?.role, 'user')
  assert.equal(result.projectedMessages.some((message) => message.role === 'assistant' && typeof message.content === 'string' && message.content.startsWith('echosphere.compaction_state.v1\n')), true)
  assert.deepEqual(findLatestCompactionPacket(result.projectedMessages), result.packet)
  assert.deepEqual(parseCompactionMessage(buildCompactionMessage(result.packet)), result.packet)
})

test('valid model compaction output is accepted and malformed output falls back safely', async () => {
  const messages = createConversationMessages()
  const window = selectCompactionWindow(messages, 10_000)
  assert.ok(window)
  const sourceDigest = buildCompactionSourceDigest(messages, window.boundaryIndex)
  const packet = buildFallbackCompactionPacket({
    messages: window.evictedMessages,
    sourceDigest,
    sourceMessageIds: window.sourceMessageIds,
  })

  const accepted = await compactModelMessages(createCompactionInput(
    messages,
    createTextStreamFactory(`<think>internal reasoning that must never enter the packet</think>\n${JSON.stringify(packet)}`),
  ))
  assert.ok(accepted)
  assert.equal(accepted.usedFallback, false)
  assert.equal(accepted.packet.sourceDigest, sourceDigest)

  const recovered = await compactModelMessages(createCompactionInput(
    [...messages, { role: 'user', content: 'A distinct retry input.' }],
    createTextStreamFactory('not valid packet output'),
  ))
  assert.ok(recovered)
  assert.equal(recovered.usedFallback, true)
})

test('same compaction digest shares one in-flight summarizer call', async () => {
  const messages = createConversationMessages()
  let calls = 0
  const createStream = createTextStreamFactory('not valid packet output', () => {
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
