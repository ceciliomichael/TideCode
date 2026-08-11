import assert from 'node:assert/strict'
import test from 'node:test'
import {
  loadInitialChatHistory,
  prepareRevertSessionForMessage,
  restoreWorkspaceCheckpointForMessage,
} from '../../src/hooks/chatHistoryWorkflows'
import type {
  ConversationFolderSummary,
  ConversationRecord,
  ConversationSummary,
  Message,
  UserMessageRunCheckpoint,
} from '../../src/types/chat'

type WindowMock = {
  tidecodeHistory: {
    listConversations: () => Promise<ConversationSummary[]>
    listFolders: () => Promise<ConversationFolderSummary[]>
    getConversation: (conversationId: string) => Promise<ConversationRecord | null>
    getUserMessageCheckpointHistory: (conversationId: string, messageId: string) => Promise<UserMessageRunCheckpoint[]>
  }
  tidecodeWorkspace: {
    createRedoCheckpointFromSource: (sourceCheckpointId: string) => Promise<UserMessageRunCheckpoint>
    createRedoCheckpointFromSources: (sourceCheckpointIds: string[]) => Promise<UserMessageRunCheckpoint>
    restoreCheckpoint: (checkpointId: string) => Promise<void>
    restoreCheckpointSequence: (checkpointIds: string[]) => Promise<void>
  }
}

function installWindowMock(windowMock: WindowMock) {
  const globalWithWindow = globalThis as typeof globalThis & { window?: WindowMock }
  const previousWindow = globalWithWindow.window
  globalWithWindow.window = windowMock

  return () => {
    if (previousWindow === undefined) {
      delete globalWithWindow.window
      return
    }

    globalWithWindow.window = previousWindow
  }
}

function buildConversation(messages: Message[]): ConversationRecord {
  return {
    agentContextRootPath: '/workspace',
    chatMode: 'agent',
    createdAt: 1,
    folderId: null,
    id: 'conversation-1',
    messages,
    title: 'Thread',
    updatedAt: messages.at(-1)?.timestamp ?? 1,
  }
}

test('revert helpers rewind the clicked message and every later user turn', async () => {
  const firstCheckpoint: UserMessageRunCheckpoint = {
    createdAt: 100,
    id: 'checkpoint-1',
  }
  const secondCheckpoint: UserMessageRunCheckpoint = {
    createdAt: 200,
    id: 'checkpoint-2',
  }
  const thirdCheckpoint: UserMessageRunCheckpoint = {
    createdAt: 300,
    id: 'checkpoint-3',
  }
  const redoCheckpoint: UserMessageRunCheckpoint = {
    createdAt: 301,
    id: 'checkpoint-redo',
  }
  const conversation = buildConversation([
    {
      content: 'message 1',
      id: 'message-1',
      reasoningEffort: 'minimal',
      role: 'user',
      timestamp: 10,
      runCheckpoint: firstCheckpoint,
    },
    {
      content: 'assistant 1',
      id: 'assistant-1',
      role: 'assistant',
      timestamp: 20,
      toolInvocations: [
        {
          argumentsText: '{}',
          id: 'plan-call',
          startedAt: 20,
          state: 'completed',
          toolName: 'plan_create',
        },
      ],
    },
    {
      content: 'message 2',
      id: 'message-2',
      reasoningEffort: 'minimal',
      role: 'user',
      timestamp: 30,
      runCheckpoint: secondCheckpoint,
    },
    {
      content: 'assistant 2',
      id: 'assistant-2',
      role: 'assistant',
      timestamp: 40,
    },
    {
      content: 'message 3',
      id: 'message-3',
      reasoningEffort: 'minimal',
      role: 'user',
      timestamp: 50,
      runCheckpoint: thirdCheckpoint,
    },
  ])
  const restoreCheckpointCalls: string[][] = []
  const redoCheckpointCalls: string[][] = []
  const restoreWindow = installWindowMock({
    tidecodeHistory: {
      getConversation: async (conversationId) => (conversationId === conversation.id ? conversation : null),
      listConversations: async () => [],
      listFolders: async () => [],
      getUserMessageCheckpointHistory: async () => {
        throw new Error('history lookup should not be used when direct checkpoints exist')
      },
    },
    tidecodeWorkspace: {
      createRedoCheckpointFromSource: async (sourceCheckpointId) => {
        redoCheckpointCalls.push([sourceCheckpointId])
        return redoCheckpoint
      },
      createRedoCheckpointFromSources: async (sourceCheckpointIds) => {
        redoCheckpointCalls.push([...sourceCheckpointIds])
        return redoCheckpoint
      },
      restoreCheckpoint: async (checkpointId) => {
        restoreCheckpointCalls.push([checkpointId])
      },
      restoreCheckpointSequence: async (checkpointIds) => {
        restoreCheckpointCalls.push([...checkpointIds])
      },
    },
  })

  try {
    const revertPreparation = await prepareRevertSessionForMessage(conversation.id, 'message-1')
    const restoredConversation = await restoreWorkspaceCheckpointForMessage(conversation.id, 'message-1')

    assert.deepEqual(revertPreparation.checkpointIds, [firstCheckpoint.id, secondCheckpoint.id, thirdCheckpoint.id])
    assert.equal(revertPreparation.redoCheckpointId, redoCheckpoint.id)
    assert.deepEqual(redoCheckpointCalls, [[firstCheckpoint.id, secondCheckpoint.id, thirdCheckpoint.id]])
    assert.deepEqual(restoreCheckpointCalls, [[firstCheckpoint.id, secondCheckpoint.id, thirdCheckpoint.id]])
    assert.equal(revertPreparation.revertedChatMode, 'plan')
    assert.equal(restoredConversation.conversation.messages.length, 5)
    assert.equal(restoredConversation.targetMessage.id, 'message-1')
  } finally {
    restoreWindow()
  }
})

test('revert helpers treat checkpoint-free steer messages as part of their parent turn', async () => {
  const firstCheckpoint: UserMessageRunCheckpoint = {
    createdAt: 100,
    id: 'checkpoint-1',
  }
  const secondCheckpoint: UserMessageRunCheckpoint = {
    createdAt: 200,
    id: 'checkpoint-2',
  }
  const redoCheckpoint: UserMessageRunCheckpoint = {
    createdAt: 201,
    id: 'checkpoint-redo',
  }
  const conversation = buildConversation([
    {
      content: 'original turn',
      id: 'message-1',
      role: 'user',
      runCheckpoint: firstCheckpoint,
      timestamp: 10,
    },
    {
      content: 'assistant work before steer',
      id: 'assistant-1',
      role: 'assistant',
      timestamp: 20,
      toolInvocations: [
        {
          argumentsText: '{}',
          id: 'tool-before-steer',
          startedAt: 20,
          state: 'completed',
          toolName: 'read',
        },
      ],
    },
    {
      content: 'same-turn correction',
      id: 'steer-1',
      role: 'user',
      timestamp: 30,
      userMessageKind: 'steer',
    },
    {
      content: 'assistant work after steer',
      id: 'assistant-2',
      role: 'assistant',
      timestamp: 40,
    },
    {
      content: 'next independent turn',
      id: 'message-2',
      role: 'user',
      runCheckpoint: secondCheckpoint,
      timestamp: 50,
    },
  ])
  const redoCheckpointCalls: string[][] = []
  const restoreWindow = installWindowMock({
    tidecodeHistory: {
      getConversation: async (conversationId) => (conversationId === conversation.id ? conversation : null),
      listConversations: async () => [],
      listFolders: async () => [],
      getUserMessageCheckpointHistory: async (_conversationId, messageId) => {
        throw new Error(`checkpoint history must not be requested for ${messageId}`)
      },
    },
    tidecodeWorkspace: {
      createRedoCheckpointFromSource: async () => redoCheckpoint,
      createRedoCheckpointFromSources: async (sourceCheckpointIds) => {
        redoCheckpointCalls.push([...sourceCheckpointIds])
        return redoCheckpoint
      },
      restoreCheckpoint: async () => {},
      restoreCheckpointSequence: async () => {},
    },
  })

  try {
    const originalPreparation = await prepareRevertSessionForMessage(conversation.id, 'message-1')
    const steerPreparation = await prepareRevertSessionForMessage(conversation.id, 'steer-1')

    assert.deepEqual(originalPreparation.checkpointIds, [firstCheckpoint.id, secondCheckpoint.id])
    assert.deepEqual(steerPreparation.checkpointIds, [firstCheckpoint.id, secondCheckpoint.id])
    assert.equal(steerPreparation.messageId, 'message-1')
    assert.deepEqual(redoCheckpointCalls, [
      [firstCheckpoint.id, secondCheckpoint.id],
      [firstCheckpoint.id, secondCheckpoint.id],
    ])
  } finally {
    restoreWindow()
  }
})

test('revert helpers fall back to checkpoint history when the message checkpoint is missing', async () => {
  const historicalCheckpoint: UserMessageRunCheckpoint = {
    createdAt: 100,
    id: 'checkpoint-history',
  }
  const redoCheckpoint: UserMessageRunCheckpoint = {
    createdAt: 101,
    id: 'checkpoint-redo',
  }
  const conversation = buildConversation([
    {
      content: 'message 1',
      id: 'message-1',
      role: 'user',
      timestamp: 10,
    },
    {
      content: 'assistant 1',
      id: 'assistant-1',
      role: 'assistant',
      timestamp: 20,
    },
  ])
  const restoreCheckpointCalls: string[][] = []
  const redoCheckpointCalls: string[][] = []
  const restoreWindow = installWindowMock({
    tidecodeHistory: {
      getConversation: async (conversationId) => (conversationId === conversation.id ? conversation : null),
      listConversations: async () => [],
      listFolders: async () => [],
      getUserMessageCheckpointHistory: async () => [historicalCheckpoint],
    },
    tidecodeWorkspace: {
      createRedoCheckpointFromSource: async (sourceCheckpointId) => {
        redoCheckpointCalls.push([sourceCheckpointId])
        return redoCheckpoint
      },
      createRedoCheckpointFromSources: async (sourceCheckpointIds) => {
        redoCheckpointCalls.push([...sourceCheckpointIds])
        return redoCheckpoint
      },
      restoreCheckpoint: async (checkpointId) => {
        restoreCheckpointCalls.push([checkpointId])
      },
      restoreCheckpointSequence: async (checkpointIds) => {
        restoreCheckpointCalls.push([...checkpointIds])
      },
    },
  })

  try {
    const revertPreparation = await prepareRevertSessionForMessage(conversation.id, 'message-1')
    await restoreWorkspaceCheckpointForMessage(conversation.id, 'message-1')

    assert.deepEqual(revertPreparation.checkpointIds, [historicalCheckpoint.id])
    assert.equal(revertPreparation.redoCheckpointId, redoCheckpoint.id)
    assert.deepEqual(redoCheckpointCalls, [[historicalCheckpoint.id]])
    assert.deepEqual(restoreCheckpointCalls, [[historicalCheckpoint.id]])
  } finally {
    restoreWindow()
  }
})

test('loadInitialChatHistory keeps the workspace on an empty draft when requested', async () => {
  const conversation: ConversationRecord = buildConversation([
    {
      content: 'message 1',
      id: 'message-1',
      role: 'user',
      timestamp: 10,
    },
  ])

  const restoreWindow = installWindowMock({
    tidecodeHistory: {
      createConversation: async (input) => ({
        agentContextRootPath: '/virtual/agent/context',
        chatMode: 'agent',
        createdAt: 100,
        folderId: input?.folderId ?? null,
        id: 'new-draft-id',
        messages: [],
        title: 'New chat',
        updatedAt: 100,
      }),
      getConversation: async () => {
        throw new Error('should not load a conversation when restoring an empty draft')
      },
      listConversations: async () => [
        {
          agentContextRootPath: '/workspace',
          chatMode: 'agent',
          folderId: null,
          id: conversation.id,
          messageCount: 1,
          preview: 'message 1',
          title: conversation.title,
          updatedAt: conversation.updatedAt,
        },
      ],
      listFolders: async () => [],
      getUserMessageCheckpointHistory: async () => [],
    },
    tidecodeWorkspace: {
      createRedoCheckpointFromSource: async () => {
        throw new Error('not used')
      },
      createRedoCheckpointFromSources: async () => {
        throw new Error('not used')
      },
      restoreCheckpoint: async () => undefined,
      restoreCheckpointSequence: async () => undefined,
    },
  })

  try {
    const snapshot = await loadInitialChatHistory(null, true)

    assert.equal(snapshot.initialConversation, null)
    assert.equal(snapshot.conversationSummaries.length, 1)
  } finally {
    restoreWindow()
  }
})

test('loadInitialChatHistory opens a new thread inside preferred project folder when on a draft', async () => {
  const restoreWindow = installWindowMock({
    tidecodeHistory: {
      getConversation: async () => {
        throw new Error('should not load global conversation when on a project draft')
      },
      listConversations: async () => [
        {
          agentContextRootPath: '/other-workspace',
          chatMode: 'agent',
          folderId: 'other-folder',
          id: 'other-conv-1',
          messageCount: 5,
          preview: 'other chat',
          title: 'Other chat',
          updatedAt: 100,
        },
      ],
      listFolders: async () => [
        {
          conversationCount: 0,
          id: 'project1',
          name: 'Project One',
          path: '/workspace/project1',
        },
      ],
      getUserMessageCheckpointHistory: async () => [],
    },
    tidecodeWorkspace: {
      createRedoCheckpointFromSource: async () => undefined,
      createRedoCheckpointFromSources: async () => undefined,
      restoreCheckpoint: async () => undefined,
      restoreCheckpointSequence: async () => undefined,
    },
  })

  try {
    const snapshot = await loadInitialChatHistory(null, false, 'project1')

    assert.equal(snapshot.initialConversation, null)
    assert.equal(snapshot.initialSelectedFolderId, 'project1')
  } finally {
    restoreWindow()
  }
})


test('revert helpers surface a friendly error when conversation history cannot be loaded', async () => {
  const restoreWindow = installWindowMock({
    tidecodeHistory: {
      getConversation: async () => {
        throw new SyntaxError('Unexpected end of JSON input')
      },
      listConversations: async () => [],
      listFolders: async () => [],
      getUserMessageCheckpointHistory: async () => [],
    },
    tidecodeWorkspace: {
      createRedoCheckpointFromSource: async () => {
        throw new Error('not used')
      },
      createRedoCheckpointFromSources: async () => {
        throw new Error('not used')
      },
      restoreCheckpoint: async () => undefined,
      restoreCheckpointSequence: async () => undefined,
    },
  })

  try {
    await assert.rejects(
      prepareRevertSessionForMessage('conversation-1', 'message-1'),
      (error: unknown) => error instanceof Error && error.message === 'Unable to load conversation: conversation-1',
    )
  } finally {
    restoreWindow()
  }
})
