import assert from 'node:assert/strict'
import test from 'node:test'
import type { ModelMessage } from 'ai'
import { formatStructuredToolResultContent, parseStructuredToolResultContent } from '../../src/lib/toolResultContent'
import {
  CODE_MODE_NESTED_INVOCATION_MAX_CHARS,
  truncatePreservingEdges,
} from '../../electron/chat/shared/compaction/codeModeProjection'
import {
  estimateRetainedContextTokens,
  projectRetainedMessagesForContext,
  RETAINED_TOOL_CALL_ARGUMENT_MAX_BYTES,
  selectLatestContextByTokens,
} from '../../electron/chat/shared/compaction/retention'
import {
  hasCompactionEligibleHistory,
  hasUnresolvedToolCall,
  selectCompactionWindow,
} from '../../electron/chat/shared/compaction/window'

test('retained context keeps complete user multimodal content and tool results', () => {
  const imagePart = {
    data: { data: 'encoded-image', type: 'data' },
    mediaType: 'image/png',
    type: 'file',
  } as const
  const recentUserContent = [
    { text: 'Inspect this screenshot.', type: 'text' as const },
    imagePart,
  ]
  const toolCallArguments = {
    program: 'x'.repeat(RETAINED_TOOL_CALL_ARGUMENT_MAX_BYTES * 8),
  }
  const toolResultValue = 'complete tool result '.repeat(4_000)
  const messages: ModelMessage[] = [
    { role: 'user', content: 'Earlier request.' },
    { role: 'assistant', content: 'Earlier response.' },
    { role: 'user', content: recentUserContent },
    {
      role: 'assistant',
      content: [{
        input: toolCallArguments,
        toolCallId: 'call-large',
        toolName: 'read',
        type: 'tool-call',
      }],
    },
    {
      role: 'tool',
      content: [{
        output: { type: 'text', value: toolResultValue },
        toolCallId: 'call-large',
        toolName: 'read',
        type: 'tool-result',
      }],
    },
    { role: 'assistant', content: 'The recent operation completed.' },
  ]

  const selection = selectLatestContextByTokens(messages, 10_000)
  const projected = selection.messages
  const projectedUser = projected.find((message) => message.role === 'user')
  const projectedToolCall = projected.find((message) => message.role === 'assistant' && Array.isArray(message.content))
  const projectedToolResult = projected.find((message) => message.role === 'tool')

  assert.deepEqual(projectedUser?.content, recentUserContent)
  assert.equal(hasUnresolvedToolCall(projected), false)
  assert.ok(projectedToolCall)
  assert.ok(projectedToolResult)
  assert.notDeepEqual(
    (projectedToolCall.content as Array<Record<string, unknown>>)[0]?.input,
    toolCallArguments,
  )
  const projectedToolResultPart = (projectedToolResult.content as Array<Record<string, unknown>>)[0]
  assert.ok(projectedToolResultPart?.output)
  assert.equal(
    JSON.stringify(projectedToolResult.content).includes(toolResultValue),
    true,
  )
  assert.ok(estimateRetainedContextTokens(projected) > 10_000)
})

test('small retained tool-call arguments remain unchanged', () => {
  const input = { path: 'src/main.ts', lineStart: 1 }
  const messages: ModelMessage[] = [{
    role: 'assistant',
    content: [{
      input,
      toolCallId: 'call-small',
      toolName: 'read',
      type: 'tool-call',
    }],
  }]

  const projected = projectRetainedMessagesForContext(messages)
  assert.deepEqual(
    (projected[0]?.content as Array<Record<string, unknown>>)[0]?.input,
    input,
  )
})

test('retained context fills the token target with a partial older turn', () => {
  const imagePart = {
    data: { data: 'encoded-image', type: 'data' },
    mediaType: 'image/png',
    type: 'file' as const,
  }
  const previousTurn: ModelMessage[] = [
    {
      role: 'user',
      content: [
        { text: `Previous request ${'prior '.repeat(2_200)}`, type: 'text' },
        imagePart,
      ],
    },
    { role: 'assistant', content: `Previous evidence ${'evidence '.repeat(2_200)}` },
  ]
  const latestTurn: ModelMessage[] = [
    { role: 'user', content: `Latest request ${'latest '.repeat(1_100)}` },
    { role: 'assistant', content: `Latest evidence ${'current '.repeat(1_100)}` },
  ]
  const messages = [
    { role: 'user', content: 'Old request.' },
    { role: 'assistant', content: 'Old response.' },
    ...previousTurn,
    ...latestTurn,
  ] as ModelMessage[]
  const targetTokens = 10_000
  const latestTokens = estimateRetainedContextTokens(latestTurn)
  const combinedTokens = estimateRetainedContextTokens([...previousTurn, ...latestTurn])

  assert.ok(latestTokens < targetTokens)
  assert.ok(combinedTokens > targetTokens)

  const selection = selectLatestContextByTokens(messages, targetTokens)
  assert.deepEqual(selection.messages[0]?.content, previousTurn[0]?.content)
  assert.equal(selection.tokenCount, targetTokens)
  assert.equal(selection.messages.filter((message) => message.role === 'user').length, 2)
  assert.ok(String(selection.messages[1]?.content).length < previousTurn[1].content.length)
})

test('an oversized newest turn becomes a compactable projected source', () => {
  const messages: ModelMessage[] = [
    { role: 'user', content: 'Keep working on the release until it is fully verified.' },
    {
      role: 'assistant',
      content: [{
        input: { path: 'package-lock.json' },
        toolCallId: 'call-lockfile',
        toolName: 'read',
        type: 'tool-call',
      }],
    },
    {
      role: 'tool',
      content: [{
        output: { type: 'text', value: `Lockfile evidence ${'A'.repeat(500_000)}` },
        toolCallId: 'call-lockfile',
        toolName: 'read',
        type: 'tool-result',
      }],
    },
    {
      role: 'assistant',
      content: [{
        input: { path: 'CHANGELOG.md' },
        toolCallId: 'call-changelog',
        toolName: 'read',
        type: 'tool-call',
      }],
    },
    {
      role: 'tool',
      content: [{
        output: { type: 'text', value: `Changelog evidence ${'B'.repeat(500_000)}` },
        toolCallId: 'call-changelog',
        toolName: 'read',
        type: 'tool-result',
      }],
    },
    { role: 'assistant', content: 'The release still needs its final verification step.' },
  ]
  const targetTokens = 10_000
  const rawTokens = estimateRetainedContextTokens(messages)
  const selection = selectLatestContextByTokens(messages, targetTokens, { allowPartialNewestTurn: true })

  assert.equal(selection.startIndex, 0)
  assert.ok(rawTokens > targetTokens)
  assert.ok(selection.tokenCount < rawTokens)
  assert.ok(selection.tokenCount <= targetTokens)
  assert.equal(hasUnresolvedToolCall(selection.messages), false)
  assert.equal(hasCompactionEligibleHistory(messages, { retainedContextTokens: targetTokens }), true)

  const window = selectCompactionWindow(messages, targetTokens, { retainedContextTokens: targetTokens })
  assert.ok(window)
  assert.equal(window.boundaryIndex, messages.length)
  assert.equal(window.sourceStartIndex, 0)
  assert.equal(window.sourceEndIndex, messages.length)
  assert.deepEqual(window.evictedMessages, messages)
  assert.deepEqual(window.tailMessages, selection.messages)
})

test('a partial newest turn summarizes the complete source so projected-away current evidence is not lost', () => {
  const messages: ModelMessage[] = [
    { role: 'user', content: 'Earlier request.' },
    { role: 'assistant', content: 'Earlier response.' },
    { role: 'user', content: 'Continue the current task.' },
    {
      role: 'assistant',
      content: [{
        input: { path: 'large.log' },
        toolCallId: 'call-current',
        toolName: 'read',
        type: 'tool-call',
      }],
    },
    {
      role: 'tool',
      content: [{
        output: { type: 'text', value: `Current-turn evidence ${'E'.repeat(700_000)}` },
        toolCallId: 'call-current',
        toolName: 'read',
        type: 'tool-result',
      }],
    },
    { role: 'assistant', content: 'The current task is still in progress.' },
  ]

  const window = selectCompactionWindow(messages, 10_000, { retainedContextTokens: 10_000 })

  assert.ok(window)
  assert.equal(window.boundaryIndex, messages.length)
  assert.deepEqual(window.evictedMessages, messages)
  assert.ok(estimateRetainedContextTokens(window.tailMessages) < estimateRetainedContextTokens(messages))
})

test('a user prompt that cannot be safely reduced does not invent an intra-turn compaction window', () => {
  const messages: ModelMessage[] = [{ role: 'user', content: 'U'.repeat(500_000) }]

  assert.equal(hasCompactionEligibleHistory(messages, { retainedContextTokens: 10_000 }), false)
  assert.equal(selectCompactionWindow(messages, 10_000, { retainedContextTokens: 10_000 }), null)
})

test('partial retention keeps the final assistant result after a large tool exchange', () => {
  const previousTurn: ModelMessage[] = [
    { role: 'user', content: 'Make the preview image larger.' },
    {
      role: 'assistant',
      content: [{
        input: { path: 'src/components/preview.tsx' },
        toolCallId: 'call-preview',
        toolName: 'read',
        type: 'tool-call',
      }],
    },
    {
      role: 'tool',
      content: [{
        output: { type: 'text', value: `Large implementation evidence ${'details '.repeat(12_000)}` },
        toolCallId: 'call-preview',
        toolName: 'read',
        type: 'tool-result',
      }],
    },
    { role: 'assistant', content: 'Completed the task: maximum width is 64rem and maximum height is 48rem.' },
  ]
  const latestTurn: ModelMessage[] = [
    { role: 'user', content: 'What happened?' },
    { role: 'assistant', content: 'I am checking the retained context.' },
  ]

  const selection = selectLatestContextByTokens([
    { role: 'user', content: 'Old request.' },
    { role: 'assistant', content: 'Old response.' },
    ...previousTurn,
    ...latestTurn,
  ], 10_000)

  assert.match(JSON.stringify(selection.messages), /64rem and maximum height is 48rem/u)
  assert.equal(hasUnresolvedToolCall(selection.messages), false)
})

test('retained Code Mode exchanges preserve semantic edges and cap each nested invocation', () => {
  const program = `START OF PROGRAM\n${'A'.repeat(4_000)}\nMIDDLE_PROGRAM_ONLY\n${'B'.repeat(4_000)}\nEND OF PROGRAM`
  const nestedBody = `START OF RESULT\n${'C'.repeat(4_000)}\nMIDDLE_RESULT_ONLY\n${'D'.repeat(4_000)}\nEND OF RESULT`
  const structuredResult = formatStructuredToolResultContent({
    arguments: { code: program },
    schema: 'tidecode.tool_result/v1',
    semantics: {
      tool_calls: [{
        arguments: { path: 'src/app.ts', payload: 'x'.repeat(2_000) },
        body: nestedBody,
        name: 'read',
        status: 'success',
        summary: 'Read the requested file',
      }],
    },
    status: 'success',
    summary: 'Code Mode completed with 1 tool call.',
    toolCallId: 'code-mode-retention',
    toolName: 'code_mode',
  }, `START OF OUTER RESULT\n${'outer-middle '.repeat(1_000)}\nEND OF OUTER RESULT`)
  const messages: ModelMessage[] = [
    {
      role: 'assistant',
      content: [{
        input: { code: program },
        toolCallId: 'code-mode-retention',
        toolName: 'code_mode',
        type: 'tool-call',
      }],
    },
    {
      role: 'tool',
      content: [{
        output: { type: 'text', value: structuredResult },
        toolCallId: 'code-mode-retention',
        toolName: 'code_mode',
        type: 'tool-result',
      }],
    },
  ]

  const projected = projectRetainedMessagesForContext(messages)
  const projectedInput = (projected[0]?.content as Array<Record<string, unknown>>)[0]?.input
  const projectedProgram = typeof projectedInput === 'object' && projectedInput !== null
    ? String((projectedInput as Record<string, unknown>).code)
    : String(projectedInput)
  assert.equal(projectedProgram.includes('START OF PROGRAM'), true)
  assert.equal(projectedProgram.includes('END OF PROGRAM'), true)
  assert.equal(projectedProgram.includes('MIDDLE_PROGRAM_ONLY'), false)
  assert.equal(truncatePreservingEdges(program, projectedProgram.length).length, projectedProgram.length)

  const projectedToolPart = (projected[1]?.content as Array<Record<string, unknown>>)[0]
  const parsed = parseStructuredToolResultContent(String((projectedToolPart?.output as Record<string, unknown>)?.value))
  const nestedToolCalls = parsed.metadata?.semantics?.tool_calls
  assert.ok(Array.isArray(nestedToolCalls))
  assert.ok(JSON.stringify(nestedToolCalls[0]).length <= CODE_MODE_NESTED_INVOCATION_MAX_CHARS)
  assert.match(JSON.stringify(nestedToolCalls[0]), /START OF RESULT/u)
  assert.match(JSON.stringify(nestedToolCalls[0]), /END OF RESULT/u)
  assert.match(parsed.body ?? '', /START OF OUTER RESULT/u)
  assert.match(parsed.body ?? '', /END OF OUTER RESULT/u)
})
