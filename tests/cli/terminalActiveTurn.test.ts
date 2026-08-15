import test from 'node:test'
import assert from 'node:assert/strict'
import { createActiveTurnPromptPanel, renderActiveTurn, renderCommittedTurn } from '../../electron/cli/terminalActiveTurn'
import { renderTerminalActivityLine } from '../../electron/cli/terminalActivity'
import { colors } from '../../electron/cli/renderer'
import { stripAnsi, visibleWidth } from '../../electron/cli/terminalText'
import type { TranscriptEntry } from '../../electron/cli/terminalView'

function createPanel() {
  return createActiveTurnPromptPanel({
    composerWidth: 60,
    placeholder: 'Working · type your next message',
  })
}

test('active turn always keeps compose panel after live output with cursor inside it', () => {
  const initial = renderActiveTurn({
    activity: { kind: 'thinking', label: 'Thinking' },
    entries: [],
    panel: createPanel(),
  })
  const streaming = renderActiveTurn({
    activity: { kind: 'thinking', label: 'Writing' },
    entries: [{ kind: 'assistant', id: 'assistant-1', text: 'Hello! How can I help?' }],
    panel: createPanel(),
  })

  assert.match(stripAnsi(initial.lines.at(-2) ?? ''), /│ › Working · type your next message\s+│/)
  assert.match(stripAnsi(streaming.lines.at(-2) ?? ''), /│ › Working · type your next message\s+│/)
  assert.equal(streaming.cursorRow, streaming.lines.length - 2)
  assert.equal(streaming.cursorColumn, 4)
  assert.match(stripAnsi(streaming.lines[1]), /Hello! How can I help\?|Writing/)
})

test('active reasoning uses the shared loader with faded text instead of a static dot', () => {
  const render = renderActiveTurn({
    activity: { detail: 'Inspecting the workspace', kind: 'thinking', label: 'Thinking' },
    entries: [],
    panel: createPanel(),
    thinkingFrame: '⠙',
  })
  const activityLine = render.lines[render.activityRow ?? -1] ?? ''

  assert.equal(render.lines[0], '')
  assert.equal(stripAnsi(activityLine).trim(), '⠙ Thinking · Inspecting the workspace')
  assert.ok(activityLine.includes(`${colors.subtle}Thinking${colors.reset}`))
  assert.ok(activityLine.includes(`${colors.subtle}Inspecting the workspace${colors.reset}`))
  assert.doesNotMatch(stripAnsi(activityLine), /· Thinking/u)
})

test('long streamed reasoning stays faded after the preview is truncated', () => {
  const activityLine = renderTerminalActivityLine({
    detail: 'This reasoning preview is intentionally long enough to require truncation.',
    kind: 'thinking',
    label: 'Thinking',
  }, 42, '⠙')

  assert.ok(activityLine.includes(`${colors.subtle}Thinking${colors.reset}`))
  assert.ok(activityLine.includes(`${colors.separator}·${colors.reset} ${colors.subtle}`))
  assert.ok(activityLine.includes(`…${colors.reset}`))
  assert.ok(visibleWidth(activityLine) <= 42)
})

test('thinking row disappears as soon as assistant content starts', () => {
  const render = renderActiveTurn({
    activity: { kind: 'idle', label: '' },
    entries: [{ id: 'assistant-started', kind: 'assistant', text: '' }],
    panel: createPanel(),
  })

  assert.equal(render.activityRow, null)
  assert.equal(render.lines.some((line) => stripAnsi(line).includes('Thinking')), false)
})

test('committed turn contains response content without a response heading or user label', () => {
  const entries: TranscriptEntry[] = [
    { kind: 'assistant', id: 'assistant-1', text: 'The workspace is ready.' },
  ]
  const lines = renderCommittedTurn(entries).map(stripAnsi).join('\n')

  assert.equal(lines, '\n  The workspace is ready.')
  assert.doesNotMatch(lines, /TideCode response|you/i)
})

test('tool rows use plain labels with spacing at assistant boundaries', () => {
  const entries: TranscriptEntry[] = [
    { kind: 'assistant', id: 'assistant-1', text: 'I will update it.' },
    { kind: 'tool', id: 'tool-1', label: 'Edited file.md', status: 'completed' },
    { kind: 'assistant', id: 'assistant-2', text: 'The update is complete.' },
  ]
  const lines = renderCommittedTurn(entries).map(stripAnsi)
  const toolIndex = lines.findIndex((line) => line.includes('[Edited] file.md'))

  assert.ok(toolIndex > 0)
  assert.equal(lines[toolIndex - 1], '')
  assert.equal(lines[toolIndex + 1], '')
  assert.equal(lines[toolIndex].trim(), '[Edited] file.md')
  assert.doesNotMatch(lines[toolIndex], /[✓×]/u)
})

test('tool badge color communicates success and failure without status wording', () => {
  const completedLines = renderCommittedTurn([{
    id: 'tool-completed',
    kind: 'tool',
    label: 'Read WorkspaceMonacoEditor.tsx',
    status: 'completed',
  }])
  const failedLines = renderCommittedTurn([{
    detail: 'failed',
    id: 'tool-failed',
    kind: 'tool',
    label: 'Read failed WorkspaceMonacoEditor.tsx',
    status: 'failed',
  }])
  const completedLine = completedLines.find((line) => stripAnsi(line).includes('[Read]')) ?? ''
  const failedLine = failedLines.find((line) => stripAnsi(line).includes('[Read]')) ?? ''

  assert.equal(stripAnsi(failedLine).trim(), '[Read] WorkspaceMonacoEditor.tsx')
  assert.ok(completedLine.includes(`${colors.success}[Read]`))
  assert.ok(failedLine.includes(`${colors.danger}[Read]`))
  assert.equal(stripAnsi(failedLine).includes('failed'), false)
})

test('thought summaries have one blank row before following assistant text', () => {
  const renderedLines = renderCommittedTurn([
    { durationSeconds: 1.4, id: 'thought-1', kind: 'thought' },
    { id: 'assistant-1', kind: 'assistant', text: 'Here is the answer.' },
  ])
  const lines = renderedLines.map(stripAnsi)
  const thoughtIndex = lines.findIndex((line) => line.includes('Thought for 1.4s'))
  const answerIndex = lines.findIndex((line) => line.includes('Here is the answer.'))

  assert.ok(thoughtIndex >= 0)
  assert.ok(renderedLines[thoughtIndex].includes(colors.subtle))
  assert.equal(lines[thoughtIndex + 1], '')
  assert.equal(answerIndex, thoughtIndex + 2)
})
