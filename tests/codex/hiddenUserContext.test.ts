import '../configureAppRoot'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildConversationSummary,
  createMessageLogPayload,
  normalizeConversationRecord,
} from '../../electron/history/documents'
import {
  buildHiddenUserContextTransitions,
  buildRuntimeEnvironmentHiddenContextTransitions,
  buildWorkspaceInstructionsTransition,
  extractHiddenUserContexts,
} from '../../src/lib/hiddenUserContext'
import type { Message } from '../../src/types/chat'

function createUserMessage(id: string, content: string, hiddenUserContext?: Message['hiddenUserContext']): Message {
  return {
    chatMode: 'plan',
    content,
    hiddenUserContext,
    id,
    role: 'user',
    timestamp: Number(id.replace(/\D/gu, '')) || 1,
  }
}

test('chat mode markers are emitted only for persisted transitions', () => {
  const initial = buildHiddenUserContextTransitions({
    chatMode: 'plan',
    messages: [],
    terminalExecutionMode: 'sandbox',
  })
  assert.deepEqual(initial.map((context) => [context.kind, context.state]), [
    ['chat_mode', 'plan'],
    ['execution_mode', 'sandbox'],
  ])
  assert.match(initial[0]?.content ?? '', /mode="plan" state="active_until_superseded"/u)

  assert.ok((initial[0]?.content ?? '').includes('tools.plan_create({ content: string, title?: string })'))
  assert.ok((initial[0]?.content ?? '').includes('Do not use tools.tool_search to discover tools.plan_create'))
  assert.ok((initial[0]?.content ?? '').includes('stable superset of TideCode capabilities, not permission'))

  const planHistory: Message[] = [createUserMessage('user-1', 'Plan this.', initial)]
  assert.deepEqual(buildHiddenUserContextTransitions({
    chatMode: 'plan',
    messages: planHistory,
    terminalExecutionMode: 'sandbox',
  }), [])

  // UI-only Plan -> Agent -> Plan toggles write nothing, so the last persisted state is still Plan.
  assert.deepEqual(buildHiddenUserContextTransitions({
    chatMode: 'plan',
    messages: planHistory,
    terminalExecutionMode: 'sandbox',
  }), [])

  const agentTransition = buildHiddenUserContextTransitions({
    chatMode: 'agent',
    messages: planHistory,
    terminalExecutionMode: 'sandbox',
  })
  assert.deepEqual(agentTransition.map((context) => [context.kind, context.state]), [
    ['chat_mode', 'agent'],
  ])
  assert.match(agentTransition[0]?.content ?? '', /mode="agent" state="active_until_superseded"/u)
  assert.doesNotMatch(agentTransition[0]?.content ?? '', /disable plan/iu)

  const agentHistory: Message[] = [
    ...planHistory,
    { ...createUserMessage('user-2', 'Implement this.', agentTransition), chatMode: 'agent' },
  ]
  const planAgain = buildHiddenUserContextTransitions({
    chatMode: 'plan',
    messages: agentHistory,
    terminalExecutionMode: 'sandbox',
  })
  assert.deepEqual(planAgain.map((context) => [context.kind, context.state]), [
    ['chat_mode', 'plan'],
  ])
})

test('history normalization and message logs preserve exact hidden context while summaries stay visible-only', () => {
  const contexts = buildHiddenUserContextTransitions({
    chatMode: 'plan',
    messages: [],
    terminalExecutionMode: 'sandbox',
  })
  const message = createUserMessage('user-1', 'Visible request only.', contexts)
  const conversation = normalizeConversationRecord({
    agentContextRootPath: 'C:/repo',
    chatMode: 'plan',
    createdAt: 1,
    folderId: null,
    id: 'conversation-1',
    messages: [message],
    title: 'Hidden context test',
    updatedAt: 1,
  })

  assert.deepEqual(conversation.messages[0]?.hiddenUserContext, contexts)
  assert.equal(conversation.messages[0]?.content, 'Visible request only.')
  const summary = buildConversationSummary(conversation)
  assert.match(summary.preview, /Visible request only/u)
  assert.doesNotMatch(summary.preview, /hidden_user_context|chat_mode_context|execution_mode_context/u)

  const log = createMessageLogPayload(conversation.id, conversation.messages, 2)
  assert.match(log, /hiddenUserContext/u)
  assert.match(log, /active_until_superseded/u)
})

test('stored hidden context can be extracted without changing its exact serialized text', () => {
  const contexts = buildHiddenUserContextTransitions({
    chatMode: 'agent',
    messages: [],
    terminalExecutionMode: 'full',
  })
  const serialized = contexts.map((context) => context.content).join('\n\n')
  const extracted = extractHiddenUserContexts(serialized)

  assert.deepEqual(extracted, contexts)
})

test('workspace instructions persist only when their content state changes', () => {
  const initial = buildWorkspaceInstructionsTransition({
    messages: [],
    revision: 'revision-1',
  })
  assert.equal(initial.length, 1)
  assert.equal(initial[0]?.kind, 'workspace_instructions')
  assert.match(initial[0]?.content ?? '', /same revision is already available/u)
  assert.match(initial[0]?.content ?? '', /do not read the file again/u)
  assert.match(initial[0]?.content ?? '', /A root AGENTS\.md exists/u)
  assert.doesNotMatch(initial[0]?.content ?? '', /Plan before implementation/u)

  const history = [createUserMessage('user-1', 'Plan this.', initial)]
  assert.deepEqual(buildWorkspaceInstructionsTransition({
    messages: history,
    revision: 'revision-1',
  }), [])

  const changed = buildWorkspaceInstructionsTransition({
    messages: history,
    revision: 'revision-2',
  })
  assert.equal(changed.length, 1)
  assert.notEqual(changed[0]?.state, initial[0]?.state)

  assert.deepEqual(buildWorkspaceInstructionsTransition({ messages: history, revision: null }), [])
})

test('terminal shell and python venv contexts persist only on runtime environment transitions', () => {
  assert.deepEqual(buildRuntimeEnvironmentHiddenContextTransitions({
    environment: { pythonVenv: null, terminalShell: null },
    messages: [],
  }), [])

  const initialEnvironment = {
    pythonVenv: { name: '.venv', relativePath: '.venv' },
    terminalShell: { command: 'C:/Program Files/PowerShell/7/pwsh.exe', label: 'PowerShell' },
  }
  const initial = buildRuntimeEnvironmentHiddenContextTransitions({
    environment: initialEnvironment,
    messages: [],
  })
  assert.deepEqual(initial.map((context) => context.kind), ['terminal_shell', 'python_venv'])
  assert.match(initial[0]?.content ?? '', /Active terminal shell: PowerShell/u)
  assert.match(initial[1]?.content ?? '', /Python virtual environment activated: \.venv/u)

  const history = [createUserMessage('user-1', 'Inspect this.', initial)]
  assert.deepEqual(buildRuntimeEnvironmentHiddenContextTransitions({
    environment: initialEnvironment,
    messages: history,
  }), [])

  const changedShell = buildRuntimeEnvironmentHiddenContextTransitions({
    environment: {
      ...initialEnvironment,
      terminalShell: { command: '/bin/zsh', label: 'zsh' },
    },
    messages: history,
  })
  assert.deepEqual(changedShell.map((context) => context.kind), ['terminal_shell'])
  assert.match(changedShell[0]?.content ?? '', /Active terminal shell: zsh/u)

  const removedVenv = buildRuntimeEnvironmentHiddenContextTransitions({
    environment: { ...initialEnvironment, pythonVenv: null },
    messages: history,
  })
  assert.deepEqual(removedVenv.map((context) => [context.kind, context.state]), [
    ['python_venv', 'none'],
  ])
  assert.match(removedVenv[0]?.content ?? '', /No Python virtual environment is currently detected/u)

  const noVenvHistory = [
    ...history,
    createUserMessage('user-2', 'Continue.', removedVenv),
  ]
  assert.deepEqual(buildRuntimeEnvironmentHiddenContextTransitions({
    environment: { pythonVenv: null, terminalShell: initialEnvironment.terminalShell },
    messages: noVenvHistory,
  }), [])
})
