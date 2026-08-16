import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { ChatAttachment, ConversationModelPreference, ConversationRecord, Message } from '../../src/types/chat'
import { getConversationTitleFromInput } from '../../src/hooks/chatHistoryViewModels'
import { appendStoredMessages, getStoredConversation } from '../history/store'
import { readPrunedFolderStore } from '../history/folderStore'
import { writeConversationFile } from '../history/conversationFileStore'
import { createWorkspaceCheckpoint } from '../workspace/checkpoints'
import type { CliSessionState } from './types'
import { getStoredSettings } from '../settings/store'

function normalizeWorkspacePath(value: string): string {
  const resolved = path.resolve(value.trim()).replace(/\\/g, '/')
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

async function resolveWorkspaceFolderId(workspaceRootPath: string): Promise<string | null> {
  const normalizedWorkspace = normalizeWorkspacePath(workspaceRootPath)
  const folders = await readPrunedFolderStore()
  return folders.find((folder) => normalizeWorkspacePath(folder.path) === normalizedWorkspace)?.id ?? null
}

function findLatestRuntimeMessage(messages: readonly Message[]): Message | undefined {
  return [...messages].reverse().find((message) => message.modelId || message.providerId || message.reasoningEffort)
}

export function applyConversationRecordToCliState(
  state: CliSessionState,
  conversation: ConversationRecord,
  options: {
    conversationPreference?: ConversationModelPreference
    preserveModelSelection?: boolean
  } = {},
): void {
  state.conversationId = conversation.id
  state.messages = [...conversation.messages]
  state.pendingUndoEdit = undefined
  state.chatMode = conversation.chatMode
  state.workspaceRootPath = conversation.agentContextRootPath

  if (!options.preserveModelSelection) {
    const latestRuntimeMessage = findLatestRuntimeMessage(conversation.messages)
    if (latestRuntimeMessage?.modelId) state.modelId = latestRuntimeMessage.modelId
    if (latestRuntimeMessage?.providerId) state.providerId = latestRuntimeMessage.providerId
    if (latestRuntimeMessage?.reasoningEffort) state.reasoningEffort = latestRuntimeMessage.reasoningEffort

    if (options.conversationPreference) {
      state.modelId = options.conversationPreference.modelId
      if (options.conversationPreference.providerId) state.providerId = options.conversationPreference.providerId
      if (options.conversationPreference.chatMode) state.chatMode = options.conversationPreference.chatMode
      if (options.conversationPreference.reasoningEffort) {
        state.reasoningEffort = options.conversationPreference.reasoningEffort
      }
    }
  }
}

export async function createCliConversationRecord(state: CliSessionState): Promise<ConversationRecord> {
  const timestamp = Date.now()
  const record: ConversationRecord = {
    agentContextRootPath: state.workspaceRootPath,
    chatMode: state.chatMode,
    createdAt: timestamp,
    folderId: await resolveWorkspaceFolderId(state.workspaceRootPath),
    id: state.conversationId,
    isArchived: false,
    isPinned: false,
    messages: [],
    title: 'New chat',
    updatedAt: timestamp,
  }
  await writeConversationFile(record)
  return record
}

export async function initializeCliConversation(
  state: CliSessionState,
  continueId?: string,
  options: { preserveModelSelection?: boolean } = {},
): Promise<ConversationRecord | null> {
  if (!continueId) return null

  const [conversation, settings] = await Promise.all([
    getStoredConversation(continueId),
    getStoredSettings(),
  ])
  if (!conversation) throw new Error(`Conversation not found: ${continueId}`)
  applyConversationRecordToCliState(state, conversation, {
    ...options,
    conversationPreference: settings.conversationModelPreferences[continueId],
  })
  return conversation
}

export async function resumeCliConversation(state: CliSessionState, conversationId: string): Promise<ConversationRecord | null> {
  const [conversation, settings] = await Promise.all([
    getStoredConversation(conversationId),
    getStoredSettings(),
  ])
  if (!conversation) return null
  applyConversationRecordToCliState(state, conversation, {
    conversationPreference: settings.conversationModelPreferences[conversationId],
  })
  return conversation
}

export async function createAndPersistCliUserMessage(
  state: CliSessionState,
  content: string,
  attachments: readonly ChatAttachment[] = [],
): Promise<Message> {
  const existingConversation = await getStoredConversation(state.conversationId)
  if (!existingConversation) await createCliConversationRecord(state)
  const checkpoint = await createWorkspaceCheckpoint({ workspaceRootPath: state.workspaceRootPath })
  const message: Message = {
    attachments: attachments.length > 0 ? [...attachments] : undefined,
    chatMode: state.chatMode,
    content,
    id: randomUUID(),
    modelId: state.modelId,
    providerId: state.providerId,
    reasoningEffort: state.reasoningEffort,
    role: 'user',
    runCheckpoint: checkpoint,
    timestamp: Date.now(),
    userMessageKind: 'human',
  }
  const shouldSetTitle = state.messages.length === 0
  const conversation = await appendStoredMessages({
    chatMode: state.chatMode,
    conversationId: state.conversationId,
    messages: [message],
    title: shouldSetTitle ? getConversationTitleFromInput(content, attachments) : undefined,
  })
  state.messages = [...conversation.messages]
  return message
}

export async function persistCliAssistantMessages(state: CliSessionState, messages: Message[]): Promise<void> {
  if (messages.length === 0) return
  const conversation = await appendStoredMessages({
    chatMode: state.chatMode,
    conversationId: state.conversationId,
    messages,
  })
  state.messages = [...conversation.messages]
}
