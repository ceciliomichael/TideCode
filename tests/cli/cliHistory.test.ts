import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { applyConversationRecordToCliState } from '../../electron/cli/cliHistory'
import { readConversationRecordFromPath } from '../../electron/history/conversationFileReader'
import type { CliSessionState } from '../../electron/cli/types'
import type { ConversationRecord } from '../../src/types/chat'

function createState(): CliSessionState {
  return {
    activeStreamId: null,
    chatMode: 'agent',
    conversationId: 'new-conversation',
    isStreaming: false,
    messages: [],
    modelId: 'fallback-model',
    providerId: 'openai',
    reasoningEffort: 'medium',
    terminalExecutionMode: 'full',
    workspaceRootPath: 'C:/fallback',
  }
}

function createDesktopConversation(): ConversationRecord {
  return {
    agentContextRootPath: 'C:/workspace/project',
    chatMode: 'plan',
    createdAt: 10,
    folderId: 'project-folder',
    id: 'desktop-conversation',
    isArchived: false,
    isPinned: true,
    messages: [
      {
        chatMode: 'plan',
        content: 'Inspect the architecture',
        id: 'user-1',
        modelId: 'claude-test',
        providerId: 'anthropic',
        reasoningEffort: 'high',
        role: 'user',
        runCheckpoint: { createdAt: 11, id: 'checkpoint-1' },
        timestamp: 11,
        userMessageKind: 'human',
      },
      {
        content: 'The architecture is modular.',
        id: 'assistant-1',
        modelId: 'claude-test',
        providerId: 'anthropic',
        reasoningCompletedAt: 12,
        reasoningContent: 'Reviewed the module graph.',
        reasoningEffort: 'high',
        role: 'assistant',
        timestamp: 12,
        toolInvocations: [],
      },
    ],
    title: 'Architecture review',
    updatedAt: 12,
  }
}

test('CLI hydrates the exact normalized desktop conversation for continuation', async () => {
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'tidecode-cli-history-'))
  const conversationPath = path.join(tempDirectory, 'desktop-conversation.json')
  try {
    const desktopConversation = createDesktopConversation()
    await fs.writeFile(conversationPath, JSON.stringify(desktopConversation, null, 2), 'utf8')
    const normalizedRecord = await readConversationRecordFromPath(conversationPath)
    const state = createState()

    applyConversationRecordToCliState(state, normalizedRecord)

    assert.equal(state.conversationId, desktopConversation.id)
    assert.equal(state.workspaceRootPath, desktopConversation.agentContextRootPath)
    assert.equal(state.chatMode, 'plan')
    assert.equal(state.modelId, 'claude-test')
    assert.equal(state.providerId, 'anthropic')
    assert.equal(state.reasoningEffort, 'high')
    assert.deepEqual(state.messages, normalizedRecord.messages)
  } finally {
    await fs.rm(tempDirectory, { force: true, recursive: true })
  }
})

test('explicit CLI model selection can be preserved while restoring all conversation messages', () => {
  const state = createState()
  applyConversationRecordToCliState(state, createDesktopConversation(), { preserveModelSelection: true })

  assert.equal(state.modelId, 'fallback-model')
  assert.equal(state.providerId, 'openai')
  assert.equal(state.reasoningEffort, 'medium')
  assert.equal(state.messages.length, 2)
})

test('desktop conversation preference restores the selection for the conversation mode', () => {
  const state = createState()
  const conversation = createDesktopConversation()
  applyConversationRecordToCliState(state, conversation, {
    conversationPreference: {
      chatMode: 'agent',
      label: 'Agent Model',
      modelId: 'agent-model',
      providerId: 'openai',
      reasoningEffort: 'low',
      modeSelections: {
        plan: {
          label: 'Claude Test',
          modelId: 'claude-test',
          providerId: 'anthropic',
          reasoningEffort: 'max',
        },
      },
    },
  })

  assert.equal(state.chatMode, 'plan')
  assert.equal(state.modelId, 'claude-test')
  assert.equal(state.reasoningEffort, 'max')
})
