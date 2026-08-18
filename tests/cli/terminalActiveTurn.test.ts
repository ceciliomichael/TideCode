import test from 'node:test'
import assert from 'node:assert/strict'
import { createActiveTurnPromptPanel, renderActiveTurn, renderCommittedTurn } from '../../electron/cli/terminalActiveTurn'
import { renderTerminalActivityLine } from '../../electron/cli/terminalActivity'
import { colors } from '../../electron/cli/renderer'
import { renderTerminalToolRowText } from '../../electron/cli/terminalToolRow'
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
  assert.equal(stripAnsi(activityLine).trim(), '⠙ Inspecting the workspace')
  assert.equal(stripAnsi(activityLine).includes('Thinking'), false)
  assert.ok(activityLine.includes(`${colors.subtle}Inspecting the workspace${colors.reset}`))
})

test('active reasoning parses inline Markdown in preview detail', () => {
  const activityLine = renderTerminalActivityLine({
    detail: '**Diagnosing extraction bug and planning fix**',
    kind: 'thinking',
    label: 'Thinking',
  }, 100, '⠙')
  const plain = stripAnsi(activityLine)

  assert.equal(plain.trim(), '⠙ Diagnosing extraction bug and planning fix')
  assert.equal(plain.includes('Thinking'), false)
  assert.doesNotMatch(plain, /\*\*/u)
  assert.ok(activityLine.includes(`${colors.bold}${colors.foreground}Diagnosing extraction bug and planning fix${colors.reset}`))
})

test('long streamed reasoning stays faded after the preview is truncated', () => {
  const activityLine = renderTerminalActivityLine({
    detail: 'This reasoning preview is intentionally long enough to require truncation.',
    kind: 'thinking',
    label: 'Thinking',
  }, 42, '⠙')

  assert.equal(stripAnsi(activityLine).includes('Thinking'), false)
  assert.equal(stripAnsi(activityLine).includes('·'), false)
  assert.ok(activityLine.includes(`…${colors.reset}`))
  assert.ok(visibleWidth(activityLine) <= 42)
})

test('truncated reasoning Markdown stays clean and width bounded', () => {
  const activityLine = renderTerminalActivityLine({
    detail: '**Diagnosing extraction bug and planning fix**',
    kind: 'thinking',
    label: 'Thinking',
  }, 32, '⠙')
  const plain = stripAnsi(activityLine)

  assert.match(plain, /⠙ Diagnosing/u)
  assert.equal(plain.includes('Thinking'), false)
  assert.doesNotMatch(plain, /\*/u)
  assert.match(plain, /…/u)
  assert.ok(visibleWidth(activityLine) <= 32)
})

test('active turn keeps the compose panel inside a strict frame budget after many tools', () => {
  const entries: TranscriptEntry[] = Array.from({ length: 30 }, (_, index) => ({
    id: `tool-${index}`,
    kind: 'tool' as const,
    label: `Read file-${index}.ts`,
    status: 'completed' as const,
  }))
  const render = renderActiveTurn({
    activity: { detail: 'Waiting for the next step', kind: 'thinking', label: 'Thinking' },
    entries,
    followUps: [{ behavior: 'queue', text: 'keep this queued follow-up visible' }],
    maxFrameLines: 12,
    panel: createPanel(),
    thinkingFrame: '⠙',
  })
  const lines = render.lines.map(stripAnsi)

  assert.ok(render.lines.length <= 12)
  assert.match(lines.at(-2) ?? '', /│ › Working · type your next message\s+│/u)
  assert.equal(lines.filter((line) => line.includes('╭─ compose')).length, 1)
  assert.equal(lines.some((line) => line.includes('keep this queued follow-up visible')), true)
  assert.equal(lines.some((line) => line.includes('file-0.ts')), false)
})

test('active turn drops older live lines without rendering a placeholder row', () => {
  const render = renderActiveTurn({
    activity: { detail: 'Checking the latest state', kind: 'thinking', label: 'Thinking' },
    entries: [
      { id: 'assistant-1', kind: 'assistant', text: 'oldest line\nolder line\nnewer line\nnewest line' },
    ],
    maxOutputLines: 4,
    panel: createPanel(),
    thinkingFrame: '⠙',
  })
  const lines = render.lines.map(stripAnsi)
  const outputLines = lines.slice(1, 5)

  assert.equal(outputLines.some((line) => line.includes('earlier live lines')), false)
  assert.equal(outputLines.some((line) => line.includes('oldest line')), false)
  assert.equal(outputLines.some((line) => line.includes('newest line')), true)
  assert.equal(outputLines.some((line) => line.includes('Checking the latest state')), true)
  assert.equal(stripAnsi(render.lines[render.activityRow ?? -1] ?? '').includes('Checking the latest state'), true)
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

  assert.equal(lines, '\n  The workspace is ready.\n')
  assert.doesNotMatch(lines, /TideCode response|you/i)
})

test('long multiline tool labels are collapsed and truncated to one terminal row', () => {
  const command = `powershell -NoProfile -Command \"${'Write-Output very-long-command; '.repeat(12)}\nWrite-Output finished\"`
  const rendered = renderTerminalToolRowText(`Started ${command}`, 'completed', undefined, 48)
  const plain = stripAnsi(rendered)

  assert.equal(plain.includes('\n'), false)
  assert.ok(visibleWidth(rendered) <= 48)
  assert.match(plain, /^\[Started\] /u)
  assert.match(plain, /…$/u)

  const active = renderActiveTurn({
    activity: { kind: 'idle', label: '' },
    entries: [{ id: 'tool-long', kind: 'tool', label: `Started ${command}`, status: 'completed' }],
    panel: createPanel(),
  })

  assert.equal(active.lines.some((line) => line.includes('\n')), false)
  assert.equal(active.lines.map(stripAnsi).filter((line) => line.includes('[Started]')).length, 1)
  assert.match(stripAnsi(active.lines.at(-2) ?? ''), /│ › Working · type your next message\s+│/u)
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

test('reasoning has one blank row after a completed tool and before following output', () => {
  const renderedLines = renderCommittedTurn([
    { id: 'tool-1', kind: 'tool', label: 'Read file.ts', status: 'completed' },
    { durationSeconds: 0.6, id: 'thought-1', kind: 'thought' },
    { id: 'assistant-1', kind: 'assistant', text: 'Done.' },
  ]).map(stripAnsi)
  const toolIndex = renderedLines.findIndex((line) => line.includes('[Read] file.ts'))
  const thoughtIndex = renderedLines.findIndex((line) => line.includes('Thought for 0.60s'))
  const answerIndex = renderedLines.findIndex((line) => line.includes('Done.'))

  assert.equal(thoughtIndex, toolIndex + 2)
  assert.equal(renderedLines[toolIndex + 1], '')
  assert.equal(answerIndex, thoughtIndex + 2)
  assert.equal(renderedLines.at(-1), '')
})

test('live reasoning has one blank row after the previous tool', () => {
  const render = renderActiveTurn({
    activity: { detail: 'Checking the result', kind: 'thinking', label: 'Thinking' },
    entries: [{ id: 'tool-1', kind: 'tool', label: 'Read file.ts', status: 'completed' }],
    panel: createPanel(),
    thinkingFrame: '⠙',
  })
  const lines = render.lines.map(stripAnsi)
  const toolIndex = lines.findIndex((line) => line.includes('[Read] file.ts'))
  const reasoningIndex = lines.findIndex((line) => line.includes('Checking the result'))

  assert.equal(reasoningIndex, toolIndex + 2)
  assert.equal(lines[reasoningIndex].includes('Thinking'), false)
  assert.equal(lines[toolIndex + 1], '')
})
