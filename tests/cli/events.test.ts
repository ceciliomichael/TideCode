import test from 'node:test'
import assert from 'node:assert/strict'
import { createTerminalChatEventSink } from '../../electron/cli/events'
import { stripAnsi } from '../../electron/cli/terminalText'

function createPresentation() {
  return {
    onWaiting: () => undefined,
    onReasoningDelta: () => undefined,
    onReasoningCompleted: () => undefined,
    onContentStart: () => undefined,
    onContentDelta: () => undefined,
    onToolStarted: () => undefined,
    onToolCompleted: () => undefined,
    onToolFailed: () => undefined,
    onCompleted: () => undefined,
  }
}

test('presented completion notifies the REPL after committing the terminal turn', () => {
  let completed = 0
  const { sink } = createTerminalChatEventSink({
    presentation: createPresentation(),
    onComplete: () => {
      completed += 1
    },
  })

  sink.emit?.({ streamId: 'stream-1', type: 'completed' })

  assert.equal(completed, 1)
})

test('presented stream errors notify the REPL after closing the active presentation', () => {
  let errorMessage = ''
  const { sink } = createTerminalChatEventSink({
    presentation: createPresentation(),
    onError: (message) => {
      errorMessage = message
    },
  })

  sink.emit?.({ errorMessage: 'network unavailable', streamId: 'stream-1', type: 'error' })

  assert.equal(errorMessage, 'network unavailable')
})

test('presented streams do not duplicate cumulative provider snapshots', () => {
  const content: string[] = []
  const reasoning: string[] = []
  const { sink, getAccumulatedText } = createTerminalChatEventSink({
    presentation: {
      ...createPresentation(),
      onReasoningDelta: (delta) => reasoning.push(delta),
      onContentDelta: (delta) => content.push(delta),
    },
  })

  sink.emit?.({ delta: 'Thinking about the workspace', streamId: 'stream-2', type: 'reasoning_delta' })
  sink.emit?.({ delta: 'Thinking about the workspace and the app', streamId: 'stream-2', type: 'reasoning_delta' })
  sink.emit?.({ streamId: 'stream-2', type: 'reasoning_completed' })
  sink.emit?.({ delta: 'The app is TideCode', streamId: 'stream-2', type: 'content_delta' })
  sink.emit?.({ delta: 'The app is TideCode, a desktop AI workspace.', streamId: 'stream-2', type: 'content_delta' })

  assert.deepEqual(reasoning, ['Thinking about the workspace', ' and the app'])
  assert.deepEqual(content, ['The app is TideCode', ', a desktop AI workspace.'])
  assert.equal(getAccumulatedText(), 'The app is TideCode, a desktop AI workspace.')
})

test('presented reasoning is committed before content even when the provider omits reasoning_completed', () => {
  const calls: string[] = []
  const { sink } = createTerminalChatEventSink({
    presentation: {
      ...createPresentation(),
      onReasoningDelta: () => calls.push('reasoning_delta'),
      onReasoningCompleted: () => calls.push('reasoning_completed'),
      onContentStart: () => calls.push('content_start'),
      onContentDelta: () => calls.push('content_delta'),
    },
  })

  sink.emit?.({ delta: 'Checking the answer', streamId: 'stream-content-boundary', type: 'reasoning_delta' })
  sink.emit?.({ delta: 'Done.', streamId: 'stream-content-boundary', type: 'content_delta' })

  assert.deepEqual(calls, ['reasoning_delta', 'reasoning_completed', 'content_start', 'content_delta'])
})

test('a late reasoning_completed after a tool boundary does not commit the same thought twice', () => {
  let completedReasoning = 0
  const { sink } = createTerminalChatEventSink({
    presentation: {
      ...createPresentation(),
      onReasoningCompleted: () => {
        completedReasoning += 1
      },
    },
  })

  sink.emit?.({ delta: 'Planning the edit', streamId: 'stream-late-boundary', type: 'reasoning_delta' })
  sink.emit?.({
    argumentsText: '{}',
    invocationId: 'tool-late',
    startedAt: Date.now(),
    streamId: 'stream-late-boundary',
    toolName: 'read',
    type: 'tool_invocation_started',
  })
  sink.emit?.({ streamId: 'stream-late-boundary', type: 'reasoning_completed' })

  assert.equal(completedReasoning, 1)
})

test('presented tool completion keeps result bodies out of the CLI transcript', () => {
  let startedTools = 0
  let completedTool: { label: string; detail?: string; diff?: string } | null = null
  const { sink } = createTerminalChatEventSink({
    workspaceRootPath: 'C:/workspace',
    presentation: {
      ...createPresentation(),
      onToolStarted: () => {
        startedTools += 1
      },
      onToolCompleted: (label, detail, diff) => {
        completedTool = { label, detail, diff }
      },
    },
  })

  sink.emit?.({
    argumentsText: '{"path":"C:/workspace/README.md"}',
    invocationId: 'tool-1',
    startedAt: Date.now(),
    streamId: 'stream-3',
    toolName: 'read',
    type: 'tool_invocation_started',
  })

  sink.emit?.({
    argumentsText: '{"path":"C:/workspace/README.md"}',
    completedAt: Date.now(),
    invocationId: 'tool-1',
    resultContent: JSON.stringify({ body: 'private tool output', metadata: { semantics: { has_more: false } } }),
    streamId: 'stream-3',
    syntheticMessage: { content: 'private tool output', id: 'tool-message', role: 'tool', timestamp: Date.now(), toolCallId: 'tool-1' },
    toolName: 'read',
    type: 'tool_invocation_completed',
  })

  assert.equal(startedTools, 1)
  assert.equal(stripAnsi(completedTool?.label ?? ''), 'Read README.md')
  assert.equal(completedTool?.detail, undefined)
  assert.equal(completedTool?.diff, undefined)
})
