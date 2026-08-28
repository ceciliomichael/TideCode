import '../configureAppRoot'
import assert from 'node:assert/strict'
import test from 'node:test'
import { openai } from '@ai-sdk/openai'
import type { WebContents } from 'electron'
import { buildPromptContextManifest } from '../../electron/chat/cache/canonicalization'
import { buildChatSystemPrompt, buildModelMessages } from '../../electron/chat/shared/messages'
import { stripExecutionModeContext } from '../../src/lib/executionModeContext'
import {
  buildCompressedHistoryAcknowledgementMessage,
  buildCompressedHistoryMessage,
} from '../../src/lib/chatCompression'
import { createNativeAgentTools as createAgentTools } from '../../electron/chat/shared/tools'
import type { Message } from '../../src/types/chat'
import { buildHiddenUserContextTransitions } from '../../src/lib/hiddenUserContext'

const webContentsStub = {
  id: 77,
  isDestroyed: () => false,
  once: () => undefined,
} as unknown as WebContents

test('execution mode context is persisted once for a stable mode', () => {
  const initial = buildHiddenUserContextTransitions({
    chatMode: 'agent',
    messages: [],
    terminalExecutionMode: 'sandbox',
  })
  assert.deepEqual(initial.map((context) => [context.kind, context.state]), [
    ['chat_mode', 'agent'],
    ['execution_mode', 'sandbox'],
  ])
  const messages: Message[] = [{
    chatMode: 'agent',
    content: 'First user message.',
    hiddenUserContext: initial,
    id: 'user-1',
    role: 'user',
    timestamp: 1,
  }]

  assert.deepEqual(buildHiddenUserContextTransitions({
    chatMode: 'agent',
    messages,
    terminalExecutionMode: 'sandbox',
  }), [])
})

test('execution mode changes create one persisted transition without duplicating chat mode', () => {
  const initial = buildHiddenUserContextTransitions({
    chatMode: 'agent',
    messages: [],
    terminalExecutionMode: 'sandbox',
  })
  const sandboxMessages: Message[] = [{
    chatMode: 'agent',
    content: 'First user message.',
    hiddenUserContext: initial,
    id: 'user-1',
    role: 'user',
    timestamp: 1,
  }]
  const fullTransition = buildHiddenUserContextTransitions({
    chatMode: 'agent',
    messages: sandboxMessages,
    terminalExecutionMode: 'full',
  })

  assert.equal(fullTransition.length, 1)
  assert.equal(fullTransition[0]?.kind, 'execution_mode')
  assert.equal(fullTransition[0]?.state, 'full')
  assert.match(fullTransition[0]?.content ?? '', /<execution_mode_context mode="full">/u)

  const fullMessages: Message[] = [...sandboxMessages, {
    chatMode: 'agent',
    content: 'Second user message.',
    hiddenUserContext: fullTransition,
    id: 'user-2',
    role: 'user',
    timestamp: 2,
  }]
  assert.deepEqual(buildHiddenUserContextTransitions({
    chatMode: 'agent',
    messages: fullMessages,
    terminalExecutionMode: 'full',
  }), [])
})

test('execution mode changes do not alter the system prompt or tool context fingerprint', async () => {
  const workspaceRootPath = process.cwd()
  const sandboxSystem = buildChatSystemPrompt('agent', workspaceRootPath, {
    terminalExecutionMode: 'sandbox',
  })
  const fullAccessSystem = buildChatSystemPrompt('agent', workspaceRootPath, {
    terminalExecutionMode: 'full',
  })
  const sandboxTools = await createAgentTools({
    terminalExecutionMode: 'sandbox',
    webContents: webContentsStub,
    workspaceRootPath,
  })
  const fullAccessTools = await createAgentTools({
    terminalExecutionMode: 'full',
    webContents: webContentsStub,
    workspaceRootPath,
  })
  const sandboxManifest = buildPromptContextManifest({
    modelId: 'test-model',
    providerId: 'openai',
    system: sandboxSystem,
    tools: sandboxTools,
  })
  const fullAccessManifest = buildPromptContextManifest({
    modelId: 'test-model',
    providerId: 'openai',
    system: fullAccessSystem,
    tools: fullAccessTools,
  })

  assert.equal(sandboxSystem, fullAccessSystem)
  assert.equal(sandboxManifest.systemHash, fullAccessManifest.systemHash)
  assert.equal(sandboxManifest.toolsHash, fullAccessManifest.toolsHash)
  assert.equal(sandboxManifest.fingerprint, fullAccessManifest.fingerprint)
})

test('provider-defined tool description and grammar participate in the prompt fingerprint', () => {
  const createManifest = (description: string, definition: string) => buildPromptContextManifest({
    modelId: 'test-model',
    providerId: 'codex',
    system: 'shared-system',
    tools: {
      code_mode: openai.tools.customTool({
        description,
        format: { definition, syntax: 'lark', type: 'grammar' },
      }),
    },
  })

  const baseline = createManifest('Shared Code Mode contract.', 'start: SOURCE\nSOURCE: /[\\s\\S]+/')
  const changedDescription = createManifest('Changed Code Mode contract.', 'start: SOURCE\nSOURCE: /[\\s\\S]+/')
  const changedGrammar = createManifest('Shared Code Mode contract.', 'start: SOURCE SOURCE\nSOURCE: /[\\s\\S]+/')

  assert.notEqual(baseline.toolsHash, changedDescription.toolsHash)
  assert.notEqual(baseline.toolsHash, changedGrammar.toolsHash)
  assert.notEqual(baseline.fingerprint, changedDescription.fingerprint)
  assert.notEqual(baseline.fingerprint, changedGrammar.fingerprint)
})

test('legacy compressed history sends only the handoff while preserving the UI container source', () => {
  const summary = '## Current state\n- The previous workspace task is complete.'
  const messages: Message[] = [
    {
      content: buildCompressedHistoryMessage(summary),
      id: 'compressed-history',
      role: 'user',
      timestamp: 1,
    },
    buildCompressedHistoryAcknowledgementMessage('compression-ack', 2),
    {
      content: 'What should we do next?',
      id: 'current-user',
      role: 'user',
      timestamp: 3,
    },
  ]

  const modelMessages = buildModelMessages(messages, { includeExecutionModeContext: false })

  assert.deepEqual(modelMessages, [
    { content: summary, role: 'assistant' },
    { content: 'What should we do next?', role: 'user' },
  ])
  assert.match(messages[0]?.content ?? '', /<tidecode:compressed_history>/u)
})

test('execution mode and generic hidden context are removed from compacted text', () => {
  const text = [
    'Continue the workspace implementation.',
    '',
    '<hidden_user_context kind="execution_mode" state="full">',
    '<execution_mode_context mode="full">',
    'Execution mode: full access.',
    'This must not be retained in the user-facing compacted state.',
    '</execution_mode_context>',
    '</hidden_user_context>',
    '',
    'The validation test is the next task.',
  ].join('\n')

  assert.equal(
    stripExecutionModeContext(text),
    'Continue the workspace implementation.\n\nThe validation test is the next task.',
  )
})
