import assert from 'node:assert/strict'
import test from 'node:test'
import type { ModelMessage } from 'ai'
import type { WebContents } from 'electron'
import { buildPromptContextManifest } from '../../electron/chat/cache/canonicalization'
import {
  buildChatSystemPrompt,
  buildModelMessages,
  ensureCurrentExecutionModeContext,
} from '../../electron/chat/shared/messages'
import { createNativeAgentTools as createAgentTools } from '../../electron/chat/shared/tools'
import type { Message } from '../../src/types/chat'

const webContentsStub = {
  id: 77,
  isDestroyed: () => false,
  once: () => undefined,
} as unknown as WebContents

function getUserMessageText(message: ModelMessage) {
  if (message.role !== 'user') {
    return ''
  }

  return typeof message.content === 'string'
    ? message.content
    : message.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n')
}

function createUserMessages(count: number): Message[] {
  return Array.from({ length: count }, (_, index) => ({
    content: `User message ${index + 1}`,
    id: `user-${index + 1}`,
    role: 'user' as const,
    timestamp: index + 1,
  }))
}

test('execution mode context is injected once for a stable mode', () => {
  const modelMessages = buildModelMessages(createUserMessages(11), {
    terminalExecutionMode: 'sandbox',
  })
  const messagesWithContext = ensureCurrentExecutionModeContext(modelMessages, 'sandbox')
  const userTexts = messagesWithContext
    .filter((message) => message.role === 'user')
    .map(getUserMessageText)
  const contextPositions = userTexts
    .map((text, index) => text.includes('<execution_mode_context mode="sandbox">') ? index + 1 : null)
    .filter((position): position is number => position !== null)

  assert.deepEqual(contextPositions, [1])
})

test('execution mode changes are injected immediately without duplicating the same context', () => {
  const sandboxMessages = buildModelMessages(createUserMessages(2), {
    terminalExecutionMode: 'sandbox',
  })
  const fullAccessMessages = ensureCurrentExecutionModeContext(sandboxMessages, 'full')
  const secondUserText = getUserMessageText(fullAccessMessages[1])

  assert.match(secondUserText, /<execution_mode_context mode="full">/u)
  assert.doesNotMatch(secondUserText, /mode="sandbox"/u)
  assert.deepEqual(
    ensureCurrentExecutionModeContext(fullAccessMessages, 'full'),
    fullAccessMessages,
  )
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
