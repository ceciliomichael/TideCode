import test from 'node:test'
import assert from 'node:assert/strict'
import { TerminalScreen } from '../../electron/cli/terminalScreen'
import { createTerminalChatEventSink } from '../../electron/cli/events'
import { createReplCommandHelpers } from '../../electron/cli/replCommands'
import type { TerminalOutput } from '../../electron/cli/terminalOutput'
import { stripAnsi } from '../../electron/cli/terminalText'
import { TerminalGridOutput } from './terminalHarness'
import type { Message } from '../../src/types/chat'
import type { CliSessionState } from '../../electron/cli/types'
import { navigateUndoEditSelection } from '../../electron/cli/undoEditNavigation'

class RecordingOutput implements TerminalOutput {
  writes: string[] = []
  cursorColumns: number[] = []
  moves: Array<{ dx: number; dy: number }> = []

  write(text: string): void {
    this.writes.push(text)
  }

  moveCursor(dx: number, dy: number): void {
    this.moves.push({ dx, dy })
  }

  cursorTo(column: number): void {
    this.cursorColumns.push(column)
  }
}

function createScreen(output: TerminalOutput): TerminalScreen {
  return new TerminalScreen({
    workspace: 'C:/workspace',
    model: 'gpt-test',
    provider: 'codex',
    mode: 'agent',
    version: 'test',
    permissions: 'full access',
  }, { output })
}

test('screen lifecycle renders session before compose and keeps cursor in compose while streaming', () => {
  const output = new RecordingOutput()
  const screen = createScreen(output)
  screen.start()

  assert.equal(output.writes[0], '\x1b[2J\x1b[3J\x1b[H')
  const intro = stripAnsi(output.writes.join(''))
  assert.ok(intro.indexOf('╭─ TideCode') >= 0)
  assert.ok(intro.indexOf('╭─ TideCode') < intro.indexOf('/help'))
  assert.equal(intro.includes('╭─ compose'), false)

  screen.addUserMessage('hi')
  screen.beginTurn()
  assert.ok(output.writes.map(stripAnsi).some((write) => /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] I am working on it/u.test(write)))
  assert.match(stripAnsi(output.writes.at(-1) ?? ''), /Enter steer · Tab queue · Esc stop/)
  assert.equal(output.cursorColumns.at(-1), 4)

  screen.eventPresentation.onContentStart()
  assert.ok(output.writes.map(stripAnsi).some((write) => write.includes('Enter steer · Tab queue · Esc stop')))
  assert.equal(output.writes.map(stripAnsi).some((write) => write.includes('Writing')), false)
  assert.equal(output.cursorColumns.at(-1), 4)

  screen.eventPresentation.onContentDelta('Hello! How can I help?')
  assert.ok(output.writes.map(stripAnsi).some((write) => write.includes('Hello! How can I help?')))
  assert.equal(output.cursorColumns.at(-1), 4)

  screen.eventPresentation.onCompleted()
  assert.ok(output.writes.map(stripAnsi).includes('\n  Hello! How can I help?\n\n'))
})

test('screen rebuilds one responsive compose frame after a terminal resize', () => {
  const output = new TerminalGridOutput()
  const screen = createScreen(output)
  screen.start()
  void screen.ask({
    mode: 'agent',
    modelId: 'gpt-test',
    providerId: 'codex',
  })

  const internals = screen as unknown as { handleResize: () => void }
  internals.handleResize()

  const rows = output.visibleRows()
  assert.equal(rows.filter((row) => row.includes('╭─ compose')).length, 1)
  assert.equal(rows.filter((row) => row.includes('╰')).length >= 1, true)
  const resizeFrame = output.writes.at(-1) ?? ''
  const escape = String.fromCharCode(27)
  assert.equal(resizeFrame.startsWith(`${escape}[?2026h${escape}[?25l${escape}[2J${escape}[H`), true)
  assert.equal(resizeFrame.endsWith(`${escape}[?2026l`), true)

  screen.dismissPrompt()
})

test('screen lifecycle leaves one intact active compose frame in a terminal grid', () => {
  const output = new TerminalGridOutput()
  const screen = createScreen(output)
  screen.start()
  screen.addUserMessage('hi')
  screen.beginTurn()
  screen.eventPresentation.onContentStart()
  screen.eventPresentation.onContentDelta('Hello response')

  const rows = output.visibleRows()
  assert.equal(rows.filter((row) => row.includes('╭─ compose')).length, 1)
  assert.equal(rows.filter((row) => row.includes('Enter steer · Tab queue · Esc stop')).length, 1)
  const userRow = rows.findIndex((row) => row.includes('› hi'))
  const responseRow = rows.findIndex((row) => row.includes('Hello response'))
  const composeRow = rows.findIndex((row) => row.includes('╭─ compose'))
  assert.ok(userRow >= 0)
  assert.ok(responseRow > userRow)
  assert.ok(composeRow > responseRow)
  assert.equal(rows[composeRow - 1], '')
})

test('screen atomically replaces an idle composer when a remote shared run starts', () => {
  const output = new TerminalGridOutput()
  const screen = createScreen(output)
  screen.start()
  void screen.ask({ mode: 'agent', modelId: 'gpt-test', providerId: 'codex' })
  screen.restoreConversation([
    { content: 'Edited desktop prompt', id: 'user-remote', role: 'user', timestamp: 1 },
  ], {}, true)

  screen.beginTurn(undefined, { leadingSpacer: false })
  screen.eventPresentation.onReasoningDelta('Inspecting')

  const activeRows = output.visibleRows()
  const remoteUserRow = activeRows.findIndex((row) => row.includes('Edited desktop prompt'))
  const remoteThinkingRow = activeRows.findIndex((row) => row.includes('Thinking'))
  assert.equal(remoteThinkingRow - remoteUserRow, 2)
  assert.equal(activeRows[remoteUserRow + 1], '')
  assert.equal(activeRows.filter((row) => row.includes('╭─ compose')).length, 1)
  assert.equal(activeRows.filter((row) => row.includes('Enter steer · Tab queue · Esc stop')).length, 1)
  assert.equal(activeRows.filter((row) => row.includes('Ask TideCode to inspect or change your workspace')).length, 0)
  assert.equal(activeRows.filter((row) => row.includes('Edited desktop prompt')).length, 1)

  screen.eventPresentation.onReasoningCompleted(0.1)
  screen.eventPresentation.onCompleted()

  const completedRows = output.visibleRows()
  assert.equal(completedRows.filter((row) => row.includes('╭─ compose')).length, 1)
  assert.equal(completedRows.filter((row) => row.includes('Enter steer · Tab queue · Esc stop')).length, 0)
  assert.equal(completedRows.filter((row) => row.includes('Edited desktop prompt')).length, 1)
  const completedUserRow = completedRows.findIndex((row) => row.includes('Edited desktop prompt'))
  const completedThoughtRow = completedRows.findIndex((row) => row.includes('Thought for'))
  assert.equal(completedThoughtRow - completedUserRow, 2)
  assert.equal(completedRows[completedUserRow + 1], '')
  screen.dismissPrompt()
})

test('/undo browses previous user turns without mutating history until submission', async () => {
  const output = new TerminalGridOutput()
  const screen = createScreen(output)
  const messages: Message[] = [
    { content: 'first prompt', id: 'user-1', role: 'user', timestamp: 1, userMessageKind: 'human' },
   { content: 'first answer', id: 'assistant-1', role: 'assistant', timestamp: 2 },
   { content: 'second prompt', id: 'user-2', role: 'user', timestamp: 3, userMessageKind: 'human' },
    { content: 'second answer', id: 'assistant-2', role: 'assistant', timestamp: 4 },
    { content: 'third prompt', id: 'user-3', role: 'user', timestamp: 5, userMessageKind: 'human' },
   { content: 'third answer', id: 'assistant-3', role: 'assistant', timestamp: 6 },
  ]
  const state: CliSessionState = {
    activeStreamId: null,
    chatMode: 'agent',
    conversationId: 'conversation-1',
    isStreaming: false,
    messages: [...messages],
    modelId: 'gpt-test',
    providerId: 'codex',
    reasoningEffort: 'medium',
    terminalExecutionMode: 'full',
    workspaceRootPath: 'C:/workspace',
  }

  screen.start()
  screen.restoreConversation(state.messages)
  const helpers = createReplCommandHelpers(state, screen)
  await helpers.undoLastTurn()

  assert.deepEqual(state.messages.map((message) => message.id), messages.map((message) => message.id))
  assert.equal(state.pendingUndoEdit?.targetUserMessageId, 'user-3')
  assert.equal(output.visibleRows().some((row) => row.includes('third prompt')), true)
  assert.equal(output.visibleRows().some((row) => row.includes('third answer')), true)
  assert.equal(output.visibleRows().some((row) => row.includes('second answer')), true)
  assert.equal(output.visibleRows().some((row) => row.includes('▸ third prompt')), true)

  const submissionPromise = screen.ask({
    mode: 'agent',
    modelId: 'gpt-test',
    providerId: 'codex',
    onCancelDraft: () => {
      state.pendingUndoEdit = undefined
    },
    onNavigateUndoEdit: (direction) => {
      const pendingUndoEdit = state.pendingUndoEdit
      if (!pendingUndoEdit) return undefined
      const selection = navigateUndoEditSelection(
        state.messages,
        pendingUndoEdit.targetUserMessageId,
        direction,
      )
      if (!selection) return null
      state.pendingUndoEdit = { targetUserMessageId: selection.targetUserMessageId }
      return {
        text: selection.text,
        attachments: selection.attachments,
        targetUserMessageId: selection.targetUserMessageId,
      }
    },
  })

  screen.handleInputAction({ type: 'move-up' })
  assert.equal(state.pendingUndoEdit?.targetUserMessageId, 'user-2')
  assert.equal(output.visibleRows().some((row) => row.includes('first answer')), true)
  assert.equal(output.visibleRows().some((row) => row.includes('second answer')), true)
  assert.equal(output.visibleRows().some((row) => row.includes('third answer')), true)
  assert.equal(output.visibleRows().some((row) => row.includes('▸ second prompt')), true)

  screen.handleInputAction({ type: 'move-up' })
  assert.equal(state.pendingUndoEdit?.targetUserMessageId, 'user-1')
  assert.equal(output.visibleRows().some((row) => row.includes('first answer')), true)
  assert.equal(output.visibleRows().some((row) => row.includes('second answer')), true)
  assert.equal(output.visibleRows().some((row) => row.includes('third answer')), true)
  assert.equal(output.visibleRows().some((row) => row.includes('▸ first prompt')), true)

  // The oldest/newest boundaries do not wrap around.
  screen.handleInputAction({ type: 'move-up' })
  assert.equal(state.pendingUndoEdit?.targetUserMessageId, 'user-1')

  screen.handleInputAction({ type: 'move-down' })
  assert.equal(state.pendingUndoEdit?.targetUserMessageId, 'user-2')
  assert.equal(output.visibleRows().some((row) => row.includes('first answer')), true)
  assert.equal(output.visibleRows().some((row) => row.includes('second answer')), true)
  assert.equal(output.visibleRows().some((row) => row.includes('third answer')), true)
  assert.equal(output.visibleRows().some((row) => row.includes('▸ second prompt')), true)
  assert.deepEqual(state.messages.map((message) => message.id), messages.map((message) => message.id))

  screen.handleInputAction({ type: 'submit' })
  const submission = await submissionPromise
  assert.equal(submission.text, 'second prompt')
  assert.equal(state.pendingUndoEdit?.targetUserMessageId, 'user-2')
  assert.deepEqual(state.messages.map((message) => message.id), messages.map((message) => message.id))
})

test('/undo cancellation leaves the full transcript untouched', async () => {
  const output = new TerminalGridOutput()
  const screen = createScreen(output)
  const messages: Message[] = [
    { content: 'keep this prompt', id: 'user-cancel', role: 'user', timestamp: 1, userMessageKind: 'human' },
    { content: 'keep this answer', id: 'assistant-cancel', role: 'assistant', timestamp: 2 },
  ]
  const state: CliSessionState = {
    activeStreamId: null,
    chatMode: 'agent',
    conversationId: 'conversation-cancel',
    isStreaming: false,
    messages: [...messages],
    modelId: 'gpt-test',
    providerId: 'codex',
    reasoningEffort: 'medium',
    terminalExecutionMode: 'full',
    workspaceRootPath: 'C:/workspace',
  }

  screen.start()
  screen.restoreConversation(state.messages)
  const helpers = createReplCommandHelpers(state, screen)
  await helpers.undoLastTurn()
  assert.equal(output.visibleRows().some((row) => row.includes('keep this answer')), true)
  assert.equal(output.visibleRows().some((row) => row.includes('▸ keep this prompt')), true)
  void screen.ask({
    mode: 'agent',
    modelId: 'gpt-test',
    providerId: 'codex',
    onCancelDraft: () => {
      state.pendingUndoEdit = undefined
    },
  })

  const rawScreen = screen as unknown as { handleRawStdinData(data: string): void }
  rawScreen.handleRawStdinData('\u001b')
  assert.equal(state.pendingUndoEdit, undefined)
  assert.deepEqual(state.messages.map((message) => message.id), messages.map((message) => message.id))
  assert.equal(output.visibleRows().some((row) => row.includes('keep this answer')), true)
  assert.equal(output.visibleRows().some((row) => row.includes('▸ keep this prompt')), false)
  assert.equal(output.visibleRows().some((row) => row.includes('› keep this prompt')), true)
  screen.dismissPrompt()
})

test('screen keeps a bracketed multiline paste in the composer instead of submitting it', async () => {
  const output = new TerminalGridOutput()
  const screen = createScreen(output)
  screen.start()

  const submissionPromise = screen.ask({
    mode: 'agent',
    modelId: 'gpt-test',
    providerId: 'codex',
  })
  let submission: Awaited<typeof submissionPromise> | null = null
  void submissionPromise.then((value) => {
    submission = value
  })

  const inputInternals = screen as unknown as {
    handleKeypress: (input: string, key: { ctrl?: boolean; name?: string }) => void
    handleRawStdinData: (data: string) => void
  }
  inputInternals.handleRawStdinData('\x1b[200~first line\nsecond line\x1b[201~')

  // readline emits keypress events for the same raw chunk after the paste
  // decoder sees it. A trailing Enter from that duplicate stream must not
  // submit the draft.
  inputInternals.handleKeypress('\r', { name: 'return' })
  await new Promise<void>((resolve) => setImmediate(resolve))

  assert.equal(submission, null)
  assert.ok(output.visibleRows().some((row) => row.includes('first line')))
  assert.ok(output.visibleRows().some((row) => row.includes('second line')))

  screen.handleInputAction({ type: 'submit' })
  const submitted = await submissionPromise
  assert.equal(submitted.text, 'first line\nsecond line')
})

test('screen does not add slash commands to the user transcript', async () => {
  const output = new TerminalGridOutput()
  const screen = createScreen(output)
  screen.start()

  const submissionPromise = screen.ask({
    mode: 'agent',
    modelId: 'gpt-test',
    providerId: 'codex',
  })
  screen.handleInputAction({ type: 'insert', text: '/model' })
  screen.handleInputAction({ type: 'submit' })

  await submissionPromise

  assert.equal(output.visibleRows().some((row) => row.includes('› /model')), false)
})

test('screen expands selected mention completions with the same canonical action used by desktop', async () => {
  const output = new TerminalGridOutput()
  const screen = createScreen(output)
  screen.start()

  const submissionPromise = screen.ask({
    mode: 'agent',
    modelId: 'gpt-test',
    providerId: 'codex',
    getCompletionItems: (text) => text.includes('@code')
      ? [{
          value: '@code-review',
          label: '@code-review',
          description: 'skill · Reviews code carefully.',
          mentionKind: 'skill',
          mentionPath: 'load_skill:code-review',
        }]
      : [],
  })

  screen.handleInputAction({ type: 'insert', text: '@code-rev' })
  screen.handleInputAction({ type: 'insert', text: '\t' })
  assert.equal(output.visibleRows().some((row) => row.includes('@code-review')), true)

  screen.handleInputAction({ type: 'submit' })
  const submission = await submissionPromise
  assert.equal(submission.text, '[[load_skill:code-review]]')
})

test('screen lifecycle streams reasoning text and commits its duration label', () => {
  const output = new TerminalGridOutput()
  const screen = createScreen(output)
  screen.start()
  screen.addUserMessage('hi')
  screen.beginTurn()
  screen.eventPresentation.onReasoningDelta('Inspecting the workspace')

  const streamingRows = output.visibleRows()
  assert.equal(streamingRows.filter((row) => row.includes('⠋ Thinking')).length, 1)
  assert.equal(streamingRows.filter((row) => row.includes('Inspecting the workspace')).length, 1)

  screen.eventPresentation.onReasoningCompleted(1.2)
  const completedRows = output.visibleRows()
  assert.ok(completedRows.some((row) => row.includes('Thought for 1.2s')))
  assert.equal(completedRows.some((row) => row.includes('Inspecting the workspace')), false)
  const waitingRow = completedRows.findIndex((row) => /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] I am working on it/u.test(row))
  assert.equal(waitingRow >= 0, true)
  const thoughtRow = completedRows.findIndex((row) => row.includes('Thought for 1.2s'))
  assert.equal(waitingRow - thoughtRow, 2)
  assert.equal(completedRows[thoughtRow + 1], '')
})

test('screen lifecycle keeps repeated reasoning completions in one thought until a semantic boundary', () => {
  const output = new TerminalGridOutput()
  const screen = createScreen(output)
  screen.start()
  screen.addUserMessage('hi')
  screen.beginTurn()
  screen.eventPresentation.onReasoningDelta('First reasoning segment')
  screen.eventPresentation.onReasoningCompleted(0.8)
  screen.eventPresentation.onReasoningDelta('Second reasoning segment')
  screen.eventPresentation.onReasoningCompleted(0.4)

  const rows = output.visibleRows()
  const firstThought = rows.findIndex((row) => row.includes('Thought for 1.2s'))
  assert.ok(firstThought >= 0)
  assert.equal(rows.filter((row) => row.includes('Thought for')).length, 1)
  assert.equal(rows.some((row) => row.includes('Second reasoning segment')), false)
  assert.equal(rows.some((row) => /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] I am working on it/u.test(row)), true)
})

test('live shared-run presentation commits each reasoning phase at tool boundaries', () => {
  const output = new TerminalGridOutput()
  const screen = createScreen(output)
  screen.start()
  screen.addUserMessage('create a landing page')
  screen.beginTurn()
  const { sink } = createTerminalChatEventSink({
    presentation: screen.eventPresentation,
    workspaceRootPath: 'C:/workspace',
  })

  sink.emit?.({ delta: 'Inspecting the project', streamId: 'stream-live', type: 'reasoning_delta' })
  sink.emit?.({ streamId: 'stream-live', type: 'reasoning_completed' })
  sink.emit?.({
    argumentsText: '{"path":"C:/workspace/index.html"}',
    invocationId: 'tool-1',
    startedAt: Date.now(),
    streamId: 'stream-live',
    toolName: 'read',
    type: 'tool_invocation_started',
  })
  sink.emit?.({
    argumentsText: '{"path":"C:/workspace/index.html"}',
    completedAt: Date.now(),
    invocationId: 'tool-1',
    resultContent: 'html',
    streamId: 'stream-live',
    syntheticMessage: { content: 'html', id: 'tool-message-1', role: 'tool', timestamp: Date.now(), toolCallId: 'tool-1' },
    toolName: 'read',
    type: 'tool_invocation_completed',
  })

  // Some providers transition straight from reasoning into the next tool and
  // omit/delay reasoning_completed. The tool boundary must still commit it.
  sink.emit?.({ delta: 'Planning the CSS changes', streamId: 'stream-live', type: 'reasoning_delta' })
  sink.emit?.({
    argumentsText: '{"path":"C:/workspace/styles.css"}',
    invocationId: 'tool-2',
    startedAt: Date.now(),
    streamId: 'stream-live',
    toolName: 'read',
    type: 'tool_invocation_started',
  })
  sink.emit?.({
    argumentsText: '{"path":"C:/workspace/styles.css"}',
    completedAt: Date.now(),
    invocationId: 'tool-2',
    resultContent: 'css',
    streamId: 'stream-live',
    syntheticMessage: { content: 'css', id: 'tool-message-2', role: 'tool', timestamp: Date.now(), toolCallId: 'tool-2' },
    toolName: 'read',
    type: 'tool_invocation_completed',
  })

  const rows = output.visibleRows()
  const thoughtRows = rows.filter((row) => row.includes('Thought for'))
  const firstToolIndex = rows.findIndex((row) => row.includes('[Read] index.html'))
  const secondThoughtIndex = rows.findIndex((row, index) => index > firstToolIndex && row.includes('Thought for'))
  const secondToolIndex = rows.findIndex((row) => row.includes('[Read] styles.css'))

  assert.equal(thoughtRows.length, 2)
  assert.ok(firstToolIndex >= 0)
  assert.ok(secondThoughtIndex > firstToolIndex)
  assert.ok(secondToolIndex > secondThoughtIndex)
  assert.equal(rows.some((row) => row.includes('Planning the CSS changes')), false)
  assert.equal(rows.some((row) => /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] I am working on it/u.test(row)), true)
})

test('screen lifecycle wraps long assistant lines before redrawing the active region', () => {
  const output = new TerminalGridOutput()
  const screen = createScreen(output)
  const response = 'I’m an AI assistant that can help with questions, writing, analysis, coding, and—when requested—inspect or modify files in your workspace. I follow the instructions and constraints provided for the conversation, protect private system details, and clearly report what I can or can’t do.'
  screen.start()
  screen.addUserMessage('what is system about')
  screen.beginTurn()
  screen.eventPresentation.onContentStart()
  screen.eventPresentation.onContentDelta(response)

  const rows = output.visibleRows()
  assert.equal(rows.filter((row) => row.includes('I’m an AI assistant')).length, 1)
  assert.equal(rows.filter((row) => row.includes('╭─ compose')).length, 1)
  assert.match(rows.join(' '), /clearly\s+report\s+what I can or\s+can’t do\./)
})

test('screen clears active steer and queue submissions so more messages can be entered', () => {
  const output = new TerminalGridOutput()
  const screen = createScreen(output)
  const submissions: Array<{ behavior: 'steer' | 'queue'; text: string }> = []
  screen.start()
  screen.addUserMessage('inspect the workspace')
  screen.beginTurn()

  void screen.ask({
    mode: 'agent',
    modelId: 'gpt-test',
    providerId: 'codex',
    onActiveMessage: (text, behavior) => submissions.push({ behavior, text }),
  })
  screen.handleInputAction({ type: 'insert', text: 'then run the tests' })
  screen.eventPresentation.onContentStart()
  screen.eventPresentation.onContentDelta('I am inspecting the workspace now.')

  const streamingRows = output.visibleRows()
  assert.equal(streamingRows.filter((row) => row.includes('then run the tests')).length, 1)
  assert.equal(streamingRows.filter((row) => row.includes('╭─ compose')).length, 1)

  screen.handleInputAction({ type: 'submit' })
  screen.handleInputAction({ type: 'insert', text: 'and check the build' })
  screen.handleInputAction({ type: 'alternate-submit' })
  const submittedRows = output.visibleRows()
  assert.deepEqual(submissions, [
    { behavior: 'steer', text: 'then run the tests' },
    { behavior: 'queue', text: 'and check the build' },
  ])
  assert.equal(submittedRows.filter((row) => row.includes('[Steer] then run the tests')).length, 1)
  assert.equal(submittedRows.filter((row) => row.includes('[Queued] and check the build')).length, 1)
  assert.equal(submittedRows.filter((row) => row.includes('╭─ compose')).length, 1)
  assert.equal(submittedRows.some((row) => row.includes('Enter steer · Tab queue · Esc stop')), true)

  screen.eventPresentation.onCompleted()
})

test('screen routes Escape to active turn cancellation without erasing the draft', () => {
  const output = new TerminalGridOutput()
  const screen = createScreen(output)
  let cancellationCount = 0
  screen.start()
  screen.addUserMessage('inspect the workspace')
  screen.beginTurn()
  void screen.ask({
    mode: 'agent',
    modelId: 'gpt-test',
    providerId: 'codex',
    onCancelTurn: () => { cancellationCount += 1 },
  })
  screen.handleInputAction({ type: 'insert', text: 'keep this draft' })
  screen.handleInputAction({ type: 'cancel' })

  assert.equal(cancellationCount, 1)
  assert.equal(output.visibleRows().filter((row) => row.includes('keep this draft')).length, 1)
})

test('screen routes Escape and Ctrl+C to the same active turn cancellation handler', () => {
  const output = new TerminalGridOutput()
  const screen = createScreen(output)
  let cancellationCount = 0
  const internals = screen as unknown as {
    handleKeypress: (input: string, key: { ctrl?: boolean; name?: string }) => void
  }

  screen.start()
  screen.addUserMessage('inspect the workspace')
  screen.beginTurn(() => { cancellationCount += 1 })

  internals.handleKeypress('\u001b', { name: 'escape' })
  internals.handleKeypress('\u0003', { ctrl: true, name: 'c' })

  assert.equal(cancellationCount, 2)
})

test('screen omits transitional activity labels after tools finish', () => {
  const output = new TerminalGridOutput()
  const screen = createScreen(output)
  screen.start()
  screen.addUserMessage('inspect')
  screen.beginTurn()
  screen.eventPresentation.onToolStarted('Reading workspace')
  assert.equal(output.visibleRows().some((row) => row.includes('Reading workspace')), false)
  screen.eventPresentation.onToolCompleted('Read workspace')

  let rows = output.visibleRows()
  assert.equal(rows.some((row) => row.includes('Continuing')), false)

  screen.eventPresentation.onToolStarted('Updating workspace')
  screen.eventPresentation.onToolFailed('Update failed', 'permission denied')
  rows = output.visibleRows()
  assert.equal(rows.some((row) => row.includes('Recovering')), false)
})

test('screen hides the caret for an empty active composer and restores it after the turn', () => {
  const output = new RecordingOutput()
  const screen = createScreen(output)
  screen.start()
  screen.addUserMessage('inspect')
  screen.beginTurn()
  void screen.ask({ mode: 'agent', modelId: 'gpt-test', providerId: 'codex' })

  let terminalWrites = output.writes.join('')
  assert.ok(terminalWrites.lastIndexOf('\x1b[?25l') > terminalWrites.lastIndexOf('\x1b[?25h'))

  screen.eventPresentation.onCompleted()
  terminalWrites = output.writes.join('')
  assert.ok(terminalWrites.lastIndexOf('\x1b[?25h') > terminalWrites.lastIndexOf('\x1b[?25l'))
  assert.ok(terminalWrites.includes('\x1b[6 q\x1b[?25h'))
})

test('screen keeps response, tool, thought, and later response blocks in chronological order', () => {
  const output = new TerminalGridOutput()
  const screen = createScreen(output)
  screen.start()
  screen.addUserMessage('inspect and explain')
  screen.beginTurn()
  screen.eventPresentation.onContentStart()
  screen.eventPresentation.onContentDelta('First response segment')
  screen.eventPresentation.onToolStarted('Reading files')
  screen.eventPresentation.onToolCompleted('Read files')
  screen.eventPresentation.onReasoningDelta('Checking the result')
  screen.eventPresentation.onReasoningCompleted(0.5)
  screen.eventPresentation.onContentDelta('Later response segment')

  const rows = output.visibleRows()
  const firstResponse = rows.findIndex((row) => row.includes('First response segment'))
  const tool = rows.findIndex((row) => row.includes('[Read] files'))
  const thought = rows.findIndex((row) => row.includes('Thought for 0.50s'))
  const laterResponse = rows.findIndex((row) => row.includes('Later response segment'))
  assert.ok(firstResponse >= 0)
  assert.ok(tool > firstResponse)
  assert.ok(thought > tool)
  assert.ok(laterResponse > thought)
})

test('screen keeps the compose panel visible when a remote history update redraws an idle conversation', () => {
  const output = new TerminalGridOutput()
  const screen = createScreen(output)
  screen.start()
  void screen.ask({ mode: 'agent', modelId: 'gpt-test', providerId: 'codex' })

  screen.restoreConversation([
    { content: 'Replacement user message', id: 'user-remote', role: 'user', timestamp: 1 },
  ], {}, true)

  const rows = output.visibleRows()
  assert.equal(rows.filter((row) => row.includes('Replacement user message')).length, 1)
  assert.equal(rows.filter((row) => row.includes('╭─ compose')).length, 1)
  screen.dismissPrompt()
})

test('screen restores a resumed desktop transcript before accepting the next message', () => {
  const output = new TerminalGridOutput()
  const screen = createScreen(output)
  const messages: Message[] = [
    { content: 'Previous question', id: 'user-old', role: 'user', timestamp: 1 },
    {
      content: 'Previous answer',
      id: 'assistant-old',
      reasoningCompletedAt: 2,
      reasoningContent: 'Previous reasoning',
      role: 'assistant',
      timestamp: 2,
      toolInvocations: [{
        argumentsText: '{"path":"README.md"}',
        completedAt: 2,
        id: 'tool-old',
        resultContent: 'contents',
        startedAt: 1,
        state: 'completed',
        toolName: 'read',
      }],
    },
  ]

  screen.start()
  screen.restoreConversation(messages, {}, true)

  const rows = output.visibleRows()
  const user = rows.findIndex((row) => row.includes('Previous question'))
  const thought = rows.findIndex((row) => row.includes('Thought'))
  const tool = rows.findIndex((row) => row.includes('[Read] README.md'))
  const assistant = rows.findIndex((row) => row.includes('Previous answer'))
  assert.ok(user >= 0)
  assert.ok(thought > user)
  assert.ok(tool > thought)
  assert.ok(assistant > tool)
  const outputText = output.writes.join('')
  const resumeClearIndex = outputText.lastIndexOf('\x1b[2J\x1b[3J\x1b[H')
  assert.ok(resumeClearIndex >= 0)
  assert.ok(resumeClearIndex < outputText.lastIndexOf('Previous question'))
})

test('screen redraws the active composer after an external conversation replacement', () => {
  const output = new TerminalGridOutput()
  const screen = createScreen(output)
  screen.start()
  screen.restoreConversation([
    { content: 'Keep this', id: 'user-keep', role: 'user', timestamp: 1 },
    { content: 'Remove this response', id: 'assistant-remove', role: 'assistant', timestamp: 2 },
  ])
  void screen.ask({ mode: 'agent', modelId: 'gpt-test', providerId: 'codex' })

  screen.restoreConversation([
    { content: 'Keep this', id: 'user-keep', role: 'user', timestamp: 1 },
  ], {}, true)

  const rows = output.visibleRows()
  assert.equal(rows.some((row) => row.includes('Remove this response')), false)
  assert.equal(rows.some((row) => row.includes('Keep this')), true)
  assert.equal(rows.filter((row) => row.includes('╭─ compose')).length, 1)
})

test('screen restores each thought marker for multiple desktop reasoning segments in order', () => {
  const output = new TerminalGridOutput()
  const screen = createScreen(output)
  const messages: Message[] = [
    { content: 'Inspect', id: 'user-1', role: 'user', timestamp: 1 },
    { content: '', id: 'assistant-1', reasoningContent: 'First thought', role: 'assistant', timestamp: 2 },
    { content: '', id: 'assistant-2', reasoningContent: 'Second thought', role: 'assistant', timestamp: 3 },
    { content: 'Done', id: 'assistant-3', role: 'assistant', timestamp: 4 },
  ]

  screen.start()
  screen.restoreConversation(messages)

  const rows = output.visibleRows()
  const thoughtRows = rows
    .map((row, index) => row.includes('Thought') ? index : -1)
    .filter((index) => index >= 0)
  const doneRow = rows.findIndex((row) => row.includes('Done'))

  assert.equal(thoughtRows.length, 2)
  assert.ok(thoughtRows[1] > thoughtRows[0])
  assert.ok(doneRow > thoughtRows[1])
})
