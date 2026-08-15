import assert from 'node:assert/strict'
import test from 'node:test'
import type { Message } from '../../src/types/chat'
import { createTerminalHistoryEntries } from '../../electron/cli/terminalHistory'
import { renderConversationHistory } from '../../electron/cli/terminalActiveTurn'
import { stripAnsi } from '../../electron/cli/terminalText'

test('desktop history rebuilds as ordered user, work, answer turns with visible spacing', () => {
  const messages: Message[] = [
    { content: 'First prompt', id: 'user-1', role: 'user', timestamp: 1 },
    { content: 'Implementation plan', id: 'assistant-1', reasoningContent: 'Reasoning', role: 'assistant', timestamp: 2 },
    {
      content: '',
      id: 'assistant-2',
      role: 'assistant',
      timestamp: 3,
      toolInvocations: [{
        argumentsText: '{"path":"README.md"}',
        completedAt: 4,
        id: 'tool-1',
        resultContent: 'read',
        startedAt: 3,
        state: 'completed',
        toolName: 'read',
      }],
    },
    { content: 'First answer', id: 'assistant-3', role: 'assistant', timestamp: 5 },
    { content: 'Second prompt', id: 'user-2', role: 'user', timestamp: 6 },
    { content: 'Second answer', id: 'assistant-4', role: 'assistant', timestamp: 7 },
  ]

  const entries = createTerminalHistoryEntries(messages, 'C:/workspace')
  assert.deepEqual(entries.map((entry) => (
    entry.kind === 'assistant' ? `${entry.kind}:${entry.section}` : entry.kind
  )), [
    'user',
    'thought',
    'assistant:work',
    'tool',
    'assistant:answer',
    'user',
    'assistant:answer',
  ])

  const rendered = renderConversationHistory(entries).map(stripAnsi)
  const firstAnswer = rendered.findIndex((line) => line.includes('First answer'))
  const workText = rendered.findIndex((line) => line.includes('Implementation plan'))
  const tool = rendered.findIndex((line) => line.includes('[Read] README.md'))
  const secondPrompt = rendered.findIndex((line) => line.includes('Second prompt'))
  assert.ok(tool > workText)
  assert.equal(rendered[tool - 1], '')
  assert.equal(rendered[tool].trim(), '[Read] README.md')
  assert.doesNotMatch(rendered[tool], /[✓×]/u)
  assert.equal(rendered[firstAnswer - 1], '')
  assert.ok(firstAnswer >= 0)
  assert.ok(secondPrompt > firstAnswer)
  assert.deepEqual(rendered.slice(secondPrompt - 1, secondPrompt), [''])
  assert.equal(rendered.at(-1), '')
})

test('resumed multiline and visually wrapped user messages render one prompt marker', () => {
  const rendered = renderConversationHistory([{
    kind: 'user',
    id: 'user-long',
    text: `First logical line\n${'A deliberately long continuation that must wrap within the terminal panel. '.repeat(4)}`,
  }]).map(stripAnsi)
  const contentLines = rendered.filter((line) => line.trim().length > 0)

  assert.ok(contentLines.length > 2)
  assert.equal(contentLines.filter((line) => line.includes('›')).length, 1)
  assert.match(contentLines[0], /^› First logical line$/u)
  assert.ok(contentLines.slice(1).every((line) => line.startsWith('  ')))
})

test('resumed reasoning restores and combines its saved thought duration', () => {
  const entries = createTerminalHistoryEntries([
    { content: 'Inspect', id: 'user-duration', role: 'user', timestamp: 1_000 },
    {
      content: '',
      id: 'assistant-duration-1',
      reasoningCompletedAt: 2_500,
      reasoningContent: 'First reasoning segment',
      role: 'assistant',
      timestamp: 1_000,
    },
    {
      content: 'Done',
      id: 'assistant-duration-2',
      reasoningCompletedAt: 4_000,
      reasoningContent: 'Second reasoning segment',
      role: 'assistant',
      timestamp: 2_500,
    },
  ])
  const thought = entries.find((entry) => entry.kind === 'thought')
  const rendered = renderConversationHistory(entries).map(stripAnsi)

  assert.equal(thought?.durationSeconds, 3)
  assert.equal(rendered.filter((line) => line.includes('Thought for 3.0s')).length, 1)
})
