import { v4 as uuidv4 } from 'uuid'
import type {
  ChatAttachment,
  ChatMode,
  ConversationFolderSummary,
  ConversationRecord,
  ConversationSummary,
  Message,
  ReasoningEffort,
  ChatProviderId,
  UserMessageRunCheckpoint,
} from '../types/chat'
import { getConversationTitleFromInput } from './chatHistoryViewModels'

export interface ChatHistorySnapshot {
  conversationSummaries: ConversationSummary[]
  folderSummaries: ConversationFolderSummary[]
  initialConversation: ConversationRecord | null
  initialSelectedFolderId: string | null
}

interface PersistUserTurnInput {
  activeConversationId: string | null
  chatMode: ChatMode
  compactionSourceConversationId?: string
  modelId: string
  providerId: ChatProviderId
  reasoningEffort: ReasoningEffort
  selectedFolderId: string | null
  targetEditMessageId: string | null
  attachments: ChatAttachment[]
  trimmedText: string
  title?: string
}

interface PersistUserTurnResult {
  conversation: ConversationRecord
  userMessage: Message
}

export interface RevertPreparationResult {
  messageId: string
  redoCheckpointId: string
}

function buildUserMessage(
  trimmedText: string,
  modelId: string,
  providerId: ChatProviderId,
  reasoningEffort: ReasoningEffort,
  attachments: ChatAttachment[],
  runCheckpoint: UserMessageRunCheckpoint,
  forcedId?: string,
): Message {
  return {
    attachments: attachments.length > 0 ? attachments : undefined,
    content: trimmedText,
    id: forcedId ?? uuidv4(),
    modelId,
    providerId,
    reasoningEffort,
    role: 'user',
    runCheckpoint,
    timestamp: Date.now(),
  }
}

async function loadStoredConversationOrThrow(conversationId: string) {
  try {
    const conversation = await window.tidecodeHistory.getConversation(conversationId)
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`)
    }

    return conversation
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Conversation not found:')) {
      throw error
    }

    throw new Error(`Unable to load conversation: ${conversationId}`)
  }
}

function findUserMessageOrThrow(conversation: ConversationRecord, messageId: string) {
  const targetMessageIndex = conversation.messages.findIndex(
    (message) => message.id === messageId && message.role === 'user',
  )

  if (targetMessageIndex < 0) {
    throw new Error(`Message not found: ${messageId}`)
  }

  const targetMessage = conversation.messages[targetMessageIndex]
  return {
    targetMessage,
    targetMessageIndex,
  }
}

async function resolveUserMessageCheckpointIdOrThrow(conversation: ConversationRecord, targetMessageIndex: number) {
  const targetMessage = conversation.messages[targetMessageIndex]
  const directCheckpointId = targetMessage?.runCheckpoint?.id
  if (directCheckpointId) {
    return directCheckpointId
  }

  const checkpointHistory = await window.tidecodeHistory.getUserMessageCheckpointHistory(conversation.id, targetMessage.id)
  if (checkpointHistory.length > 0) {
    return checkpointHistory.at(-1)?.id ?? checkpointHistory[0].id
  }

  throw new Error(`This message does not have a workspace checkpoint: ${targetMessage.id}`)
}

async function resolveRevertCheckpointIdsOrThrow(conversation: ConversationRecord, targetMessageIndex: number) {
  const checkpointIds: string[] = []

  for (let index = targetMessageIndex; index < conversation.messages.length; index += 1) {
    const currentMessage = conversation.messages[index]
    if (currentMessage.role !== 'user') {
      continue
    }

    checkpointIds.push(await resolveUserMessageCheckpointIdOrThrow(conversation, index))
  }

  if (checkpointIds.length === 0) {
    throw new Error('This message and later user messages do not have a workspace checkpoint.')
  }

  return checkpointIds
}

async function findUserMessageForRevertOrThrow(conversation: ConversationRecord, messageId: string) {
  const { targetMessage, targetMessageIndex } = findUserMessageOrThrow(conversation, messageId)
  const checkpointIds = await resolveRevertCheckpointIdsOrThrow(conversation, targetMessageIndex)

  return {
    checkpointIds,
    targetMessage,
    targetMessageIndex,
  }
}

async function createRunCheckpoint(agentContextRootPath: string) {
  return window.tidecodeWorkspace.createCheckpoint({
    workspaceRootPath: agentContextRootPath,
  })
}

export async function loadInitialChatHistory(
  preferredConversationId?: string | null,
  openEmptyConversationOnLaunch = false,
  preferredDraftFolderId?: string | null,
): Promise<ChatHistorySnapshot> {
  const [conversationSummaries, folderSummaries] = await Promise.all([
    window.tidecodeHistory.listConversations(),
    window.tidecodeHistory.listFolders(),
  ])

  const normalizedPreferredDraftFolderId = preferredDraftFolderId?.trim() ?? ''
  const validPreferredFolderId =
    normalizedPreferredDraftFolderId.length > 0 &&
    folderSummaries.some((folderSummary) => folderSummary.id === normalizedPreferredDraftFolderId)
      ? normalizedPreferredDraftFolderId
      : null

  if (conversationSummaries.length === 0 || openEmptyConversationOnLaunch) {
    if (!validPreferredFolderId && window.tidecodeHistory.ensureDraftAgentContext) {
      await window.tidecodeHistory.ensureDraftAgentContext()
    }

    return {
      conversationSummaries,
      folderSummaries,
      initialConversation: null,
      initialSelectedFolderId: validPreferredFolderId,
    }
  }

  const normalizedPreferredConversationId = preferredConversationId?.trim() ?? ''
  const preferredConversationSummary =
    normalizedPreferredConversationId.length > 0
      ? conversationSummaries.find((summary) => summary.id === normalizedPreferredConversationId)
      : null

  if (preferredConversationSummary) {
    if (!validPreferredFolderId || preferredConversationSummary.folderId === validPreferredFolderId) {
      const initialConversation = await window.tidecodeHistory.getConversation(preferredConversationSummary.id)
      if (initialConversation) {
        return {
          conversationSummaries,
          folderSummaries,
          initialConversation,
          initialSelectedFolderId: initialConversation.folderId ?? validPreferredFolderId,
        }
      }
    }
  }

  if (validPreferredFolderId) {
    const emptyProjectConversationSummary = conversationSummaries.find(
      (summary) =>
        summary.folderId === validPreferredFolderId &&
        (summary.preview.trim() === '' || summary.preview === 'New Chat'),
    )
    if (emptyProjectConversationSummary) {
      const initialConversation = await window.tidecodeHistory.getConversation(emptyProjectConversationSummary.id)
      if (initialConversation) {
        return {
          conversationSummaries,
          folderSummaries,
          initialConversation,
          initialSelectedFolderId: validPreferredFolderId,
        }
      }
    }

    return {
      conversationSummaries,
      folderSummaries,
      initialConversation: null,
      initialSelectedFolderId: validPreferredFolderId,
    }
  }

  const fallbackSummary = conversationSummaries[0]
  const initialConversation = await window.tidecodeHistory.getConversation(fallbackSummary.id)

  return {
    conversationSummaries,
    folderSummaries,
    initialConversation,
    initialSelectedFolderId: initialConversation?.folderId ?? null,
  }
}

export async function persistUserTurn(input: PersistUserTurnInput): Promise<PersistUserTurnResult> {
  if (input.targetEditMessageId !== null) {
    if (!input.activeConversationId) {
      throw new Error('Cannot edit a message without an active conversation.')
    }

    const currentConversation = await loadStoredConversationOrThrow(input.activeConversationId)
    const runCheckpoint = await createRunCheckpoint(currentConversation.agentContextRootPath)
    const userMessage = buildUserMessage(
      input.trimmedText,
      input.modelId,
      input.providerId,
      input.reasoningEffort,
      input.attachments,
      runCheckpoint,
      input.targetEditMessageId,
    )
    const targetMessageIndex = currentConversation.messages.findIndex(
      (message) => message.id === input.targetEditMessageId && message.role === 'user',
    )

    if (targetMessageIndex < 0) {
      throw new Error(`Message not found: ${input.targetEditMessageId}`)
    }

    const rewrittenMessages = [...currentConversation.messages.slice(0, targetMessageIndex), userMessage]
    const conversation = await window.tidecodeHistory.replaceMessages({
      chatMode: input.chatMode,
      conversationId: currentConversation.id,
      messages: rewrittenMessages,
      title:
        targetMessageIndex === 0
          ? input.title?.trim() || getConversationTitleFromInput(input.trimmedText, input.attachments)
          : undefined,
    })

    return {
      conversation,
      userMessage,
    }
  }

  let conversationId = input.activeConversationId
  let currentConversation: ConversationRecord | null = null

  if (conversationId) {
    currentConversation = await window.tidecodeHistory.getConversation(conversationId)
  } else {
    const createdConversation = await window.tidecodeHistory.createConversation({
      chatMode: input.chatMode,
      ...(input.compactionSourceConversationId
        ? { compactionSourceConversationId: input.compactionSourceConversationId }
        : {}),
      folderId: input.selectedFolderId,
    })
    conversationId = createdConversation.id
    currentConversation = createdConversation
  }

  if (!currentConversation) {
    throw new Error(`Conversation not found: ${conversationId}`)
  }

  const shouldUpdateTitle = currentConversation.messages.length === 0
  const runCheckpoint = await createRunCheckpoint(currentConversation.agentContextRootPath)
  const userMessage = buildUserMessage(
    input.trimmedText,
    input.modelId,
    input.providerId,
    input.reasoningEffort,
    input.attachments,
    runCheckpoint,
  )
  const conversation = await window.tidecodeHistory.appendMessages({
    chatMode: input.chatMode,
    conversationId,
    messages: [userMessage],
    title: shouldUpdateTitle
      ? input.title?.trim() || getConversationTitleFromInput(input.trimmedText, input.attachments)
      : undefined,
  })

  return {
    conversation,
    userMessage,
  }
}

export async function persistAssistantTurn(conversationId: string, messages: Message[]) {
  return window.tidecodeHistory.appendMessages({
    conversationId,
    messages,
  })
}

export async function persistConversationSnapshot(conversationId: string, messages: Message[]) {
  return window.tidecodeHistory.replaceMessages({
    conversationId,
    messages,
  })
}

export function getMessagesBeforeUserMessage(messages: readonly Message[], messageId: string) {
  const targetMessageIndex = messages.findIndex(
    (message) => message.id === messageId && message.role === 'user',
  )
  return targetMessageIndex < 0 ? null : messages.slice(0, targetMessageIndex)
}

export async function rollbackConversationBeforeUserMessage(conversationId: string, messageId: string) {
  const conversation = await loadStoredConversationOrThrow(conversationId)
  const messagesBeforeUserMessage = getMessagesBeforeUserMessage(conversation.messages, messageId)
  if (!messagesBeforeUserMessage) {
    return conversation
  }

  return persistConversationSnapshot(conversationId, messagesBeforeUserMessage)
}

export async function restoreWorkspaceCheckpointForMessage(conversationId: string, messageId: string) {
  const conversation = await loadStoredConversationOrThrow(conversationId)
  const { checkpointIds, targetMessage, targetMessageIndex } = await findUserMessageForRevertOrThrow(conversation, messageId)

  await window.tidecodeWorkspace.restoreCheckpointSequence(checkpointIds)
  return {
    conversation,
    targetMessage,
    targetMessageIndex,
  }
}

export async function prepareRevertSessionForMessage(
  conversationId: string,
  messageId: string,
): Promise<RevertPreparationResult> {
  const conversation = await loadStoredConversationOrThrow(conversationId)
  const { checkpointIds, targetMessage } = await findUserMessageForRevertOrThrow(conversation, messageId)
  const redoCheckpoint = await window.tidecodeWorkspace.createRedoCheckpointFromSources(checkpointIds)

  return {
    messageId: targetMessage.id,
    redoCheckpointId: redoCheckpoint.id,
  }
}
