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

test('resumed reasoning restores each saved thought duration in place', () => {
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
  const thoughts = entries.filter((entry) => entry.kind === 'thought')
  const rendered = renderConversationHistory(entries).map(stripAnsi)

  assert.deepEqual(thoughts.map((thought) => thought.durationSeconds), [1.5, 1.5])
  assert.equal(rendered.filter((line) => line.includes('Thought for 1.5s')).length, 2)
})

test('resumed history keeps a Thought for marker when only the completion timestamp was saved', () => {
  const entries = createTerminalHistoryEntries([
    { content: 'Inspect', id: 'user-fast', role: 'user', timestamp: 1_000 },
    {
      content: 'Done',
      id: 'assistant-fast',
      reasoningCompletedAt: 1_030,
      role: 'assistant',
      timestamp: 1_000,
    },
  ])
  const thought = entries.find((entry) => entry.kind === 'thought')
  const rendered = renderConversationHistory(entries).map(stripAnsi)

  assert.equal(thought?.durationSeconds, 0.03)
  assert.equal(rendered.filter((line) => line.includes('Thought for 0.03s')).length, 1)
})

test('resumed history preserves each reasoning and tool phase in transcript order', () => {
  const messages: Message[] = [
    { content: 'Inspect the transport', id: 'user-order', role: 'user', timestamp: 1_000 },
    {
      content: 'I will inspect the transport first.',
      id: 'assistant-plan-order',
      reasoningCompletedAt: 1_250,
      reasoningContent: 'Planning the inspection',
      role: 'assistant',
      timestamp: 1_000,
    },
    {
      content: 'The first file is relevant.',
      id: 'assistant-first-tool-order',
      role: 'assistant',
      timestamp: 1_300,
      toolInvocations: [{
        argumentsText: '{"path":"http.ts"}',
        completedAt: 1_500,
        id: 'tool-first-order',
        resultContent: 'read',
        startedAt: 1_300,
        state: 'completed',
        toolName: 'read',
      }],
    },
    {
      content: '',
      id: 'assistant-second-thought-order',
      reasoningCompletedAt: 1_800,
      reasoningContent: 'Planning the next inspection',
      role: 'assistant',
      timestamp: 1_600,
    },
    {
      content: '',
      id: 'assistant-second-tool-order',
      role: 'assistant',
      timestamp: 1_850,
      toolInvocations: [{
        argumentsText: '{"path":"README.md"}',
        completedAt: 2_000,
        id: 'tool-second-order',
        resultContent: 'read',
        startedAt: 1_850,
        state: 'completed',
        toolName: 'read',
      }],
    },
    { content: 'Here is the result.', id: 'assistant-answer-order', role: 'assistant', timestamp: 2_100 },
  ]

  const entries = createTerminalHistoryEntries(messages, 'C:/workspace')
  assert.deepEqual(entries.map((entry) => (
    entry.kind === 'assistant' ? `${entry.kind}:${entry.section}` : entry.kind
  )), [
    'user',
    'thought',
    'assistant:work',
    'assistant:work',
    'tool',
    'thought',
    'tool',
    'assistant:answer',
  ])

  const rendered = renderConversationHistory(entries).map(stripAnsi)
  const firstTool = rendered.findIndex((line) => line.includes('[Read] http.ts'))
  const secondThought = rendered.findIndex((line) => line.includes('Thought for 0.20s'))
  const secondTool = rendered.findIndex((line) => line.includes('[Read] README.md'))
  const answer = rendered.findIndex((line) => line.includes('Here is the result.'))

  assert.ok(firstTool > rendered.findIndex((line) => line.includes('The first file is relevant.')))
  assert.ok(secondThought > firstTool)
  assert.ok(secondTool > secondThought)
  assert.ok(answer > secondTool)
})
