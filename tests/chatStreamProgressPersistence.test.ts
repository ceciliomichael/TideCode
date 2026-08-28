import assert from 'node:assert/strict'
import test from 'node:test'
import { createChatStreamProgressPersistenceController } from '../src/hooks/chatStreamProgressPersistence'
import type { ConversationRecord, Message } from '../src/types/chat'

function createConversation(messages: Message[]): ConversationRecord {
  return {
    agentContextRootPath: '/tmp/agent-context',
    chatMode: 'agent',
    createdAt: 1,
    folderId: null,
    id: 'conversation-1',
    messages,
    title: 'Chat',
    updatedAt: 1,
  }
}

function createMessage(id: string, content: string): Message {
  return {
    content,
    id,
    role: 'user',
    timestamp: 1,
  }
}

test('discard waits for an in-flight snapshot and rejects snapshots queued after revert', async () => {
  const persistedSnapshots: string[][] = []
  let releaseFirstWrite: (() => void) | null = null
  const firstWriteFinished = new Promise<void>((resolve) => {
    releaseFirstWrite = resolve
  })

  const controller = createChatStreamProgressPersistenceController({
    conversationId: 'conversation-1',
    persistSnapshot: async (_conversationId, messages) => {
      persistedSnapshots.push(messages.map((message) => message.id))
      if (persistedSnapshots.length === 1) {
        await firstWriteFinished
      }
      return createConversation(messages)
    },
    setError: () => undefined,
  })

  controller.queueSnapshot([createMessage('reverted-user', 'Hi')], { immediate: true })
  await new Promise<void>((resolve) => setImmediate(resolve))

  const discardPromise = controller.discard()
  controller.queueSnapshot([createMessage('resent-user', 'Hi')], { immediate: true })
  releaseFirstWrite?.()
  await discardPromise

  assert.deepEqual(persistedSnapshots, [['reverted-user']])
})

test('the reverted-turn guard prevents a pending stream snapshot from being written', async () => {
  let isReverted = false
  const persistedSnapshots: string[][] = []
  const controller = createChatStreamProgressPersistenceController({
    conversationId: 'conversation-1',
    persistSnapshot: async (_conversationId, messages) => {
      persistedSnapshots.push(messages.map((message) => message.id))
      return createConversation(messages)
    },
    setError: () => undefined,
    shouldDiscard: () => isReverted,
  })

  isReverted = true
  controller.queueSnapshot([createMessage('reverted-user', 'Hi')], { immediate: true })
  await controller.flush()

  assert.deepEqual(persistedSnapshots, [])
})

test('transient tool argument snapshots are skipped until a durable boundary is queued', async () => {
  const persistedSnapshots: string[][] = []
  const controller = createChatStreamProgressPersistenceController({
    conversationId: 'conversation-1',
    persistSnapshot: async (_conversationId, messages) => {
      persistedSnapshots.push(messages.map((message) => message.id))
      return createConversation(messages)
    },
    setError: () => undefined,
  })

  controller.queueSnapshot([createMessage('partial-tool', 'partial')], { transient: true }, { deltaCharCount: 500_000 })
  await controller.flush()
  assert.deepEqual(persistedSnapshots, [])

  controller.queueSnapshot([createMessage('completed-tool', 'complete')], { immediate: true })
  await controller.flush()
  assert.deepEqual(persistedSnapshots, [['completed-tool']])
})
